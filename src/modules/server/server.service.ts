import os from 'os';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getRconPool, closeRconPool } from '../../lib/rcon.js';
import { AppError } from '../../types/index.js';
import { logger } from '../../lib/logger.js';
import { resetLogWatcher } from '../../lib/log-watcher.js';
import {
  resolveLogPath,
  resolveConfigDir,
  resolveSavesDir,
  findFactorioBinary,
} from '../../lib/paths.js';

const runningCache = new Map<string, { value: boolean; timestamp: number }>();
const CACHE_TTL_MS = 3000;

let serverProcess: ChildProcess | null = null;
let serverStartTime = 0;
let serverVersion = '';
let serverLogPath = '';
let lastExitCode: number | null = null;
let lastExitSignal: string | null = null;
let lastExitError = '';
let stoppingRequestedAt = 0;

const BLOCKED_COMMANDS = [
  /shutdown/i,
  /quit/i,
  /exit/i,
  /^lua\s*=/i,
];

const MAX_COMMAND_LENGTH = 500;

function validateCommand(command: string): void {
  if (!command || typeof command !== 'string') {
    throw new AppError('命令不能为空', 400);
  }

  if (command.length > MAX_COMMAND_LENGTH) {
    throw new AppError(`命令过长（最大 ${MAX_COMMAND_LENGTH} 字符）`, 400);
  }

  if (/[;\r\n\x00]/.test(command)) {
    throw new AppError('命令包含非法字符', 400);
  }

  for (const pattern of BLOCKED_COMMANDS) {
    if (pattern.test(command)) {
      throw new AppError('该命令被禁止执行', 403);
    }
  }
}

async function checkRconRunning(): Promise<boolean> {
  const cached = runningCache.get('rcon');
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.value;
  }

  const pool = getRconPool();
  const response = await pool.execute('/version');

  const running = response.length > 0 && !response.toLowerCase().includes('error');
  runningCache.set('rcon', { value: running, timestamp: Date.now() });

  return running;
}

export async function isRunning(): Promise<boolean> {
  return checkRconRunning();
}

function findOrphanFactorioPid(): number | null {
  try {
    const stdout = execSync('pgrep -f "factorio.*--start-server"', { timeout: 2000 }).toString().trim();
    if (!stdout) return null;
    const pids = stdout.split('\n').map(s => s.trim()).filter(Boolean);
    return pids.length > 0 ? parseInt(pids[0], 10) : null;
  } catch {
    return null;
  }
}

export function getServerProcessInfo(): {
  running: boolean;
  pid: number | null;
  startTime: number;
  version: string;
  logPath: string;
} {
  let isAlive = serverProcess !== null && serverProcess.exitCode === null && serverProcess.killed === false;
  let pid = serverProcess?.pid ?? null;

  if (!isAlive) {
    if (stoppingRequestedAt > 0 && Date.now() - stoppingRequestedAt < 20000) {
      return { running: false, pid: null, startTime: 0, version: serverVersion, logPath: serverLogPath };
    }
    const orphanPid = findOrphanFactorioPid();
    if (orphanPid) {
      isAlive = true;
      pid = orphanPid;
      if (serverStartTime === 0) serverStartTime = Date.now();
    }
  }

  return {
    running: isAlive,
    pid,
    startTime: serverStartTime,
    version: serverVersion,
    logPath: serverLogPath,
  };
}

export async function getStatus(): Promise<{
  running: boolean;
  version: string;
  players: string[];
  playerCount: number;
  processRunning: boolean;
  pid: number | null;
  uptime: number;
  logPath: string;
  lastExitCode: number | null;
  lastExitSignal: string | null;
  lastExitError: string;
}> {
  const running = await checkRconRunning();
  const procInfo = getServerProcessInfo();

  let version = 'unknown';
  const players: string[] = [];
  let playerCount = 0;

  if (running) {
    const pool = getRconPool();

    const versionRes = await pool.execute('/version');
    const versionMatch = versionRes.match(/Version:\s*([\d.]+)/i);
    if (versionMatch) {
      version = versionMatch[1];
    }

    const playersRes = await pool.execute('/players');
    if (playersRes) {
      const playerMatches = playersRes.matchAll(/(\S+)\s+\(online\)/gi);
      for (const m of playerMatches) {
        players.push(m[1]);
      }
      playerCount = players.length;
    }
  }

  const uptime = procInfo.startTime > 0 ? Math.floor((Date.now() - procInfo.startTime) / 1000) : 0;

  return {
    running,
    version,
    players,
    playerCount,
    processRunning: procInfo.running,
    pid: procInfo.pid,
    uptime,
    logPath: procInfo.logPath || serverLogPath,
    lastExitCode,
    lastExitSignal,
    lastExitError,
  };
}

export async function startServer(
  version?: string,
  map?: string,
  config?: string
): Promise<{ message: string; processRunning: boolean }> {
  const running = await checkRconRunning();
  if (running) {
    return { message: '服务器已在运行中', processRunning: true };
  }

  if (serverProcess && serverProcess.exitCode === null) {
    return { message: '服务器进程已在运行中', processRunning: true };
  }

  if (findOrphanFactorioPid()) {
    return { message: '服务器进程已在运行中（孤儿进程），请先停止', processRunning: true };
  }

  const savesDir = resolveSavesDir();
  const configDir = resolveConfigDir();

  if (!map) {
    throw new AppError('请选择要加载的地图存档', 400);
  }

  const savePath = path.join(savesDir, map);
  if (!existsSync(savePath)) {
    throw new AppError(`存档文件不存在: ${map}`, 400);
  }

  const serverSettingsFile = config || 'server-settings.json';
  const serverSettingsPath = path.join(configDir, serverSettingsFile);
  if (!existsSync(serverSettingsPath)) {
    throw new AppError(`服务器配置文件不存在: ${serverSettingsFile}`, 400);
  }

  const { binPath, rootDir } = findFactorioBinary(version);

  let rconPort = 0;
  let rconPassword = '';
  try {
    const raw = readFileSync(serverSettingsPath, 'utf-8');
    const settings = JSON.parse(raw);
    rconPort = parseInt(settings.rcon_port || settings['rcon-port'] || '0', 10);
    rconPassword = settings.rcon_password || settings['rcon-password'] || '';
  } catch {}

  const args = [
    '--start-server', savePath,
    '--server-settings', serverSettingsPath,
  ];

  if (rconPort > 0 && rconPort <= 65535 && rconPassword) {
    args.push('--rcon-port', String(rconPort));
    args.push('--rcon-password', rconPassword);
  }

  const logPath = resolveLogPath(version);
  const logDir = path.dirname(logPath);
  try { mkdirSync(logDir, { recursive: true }); } catch {}

  serverLogPath = logPath;
  serverVersion = version || '';

  logger.info({ binPath, args, cwd: rootDir, logPath }, '正在启动 Factorio 服务器');

  const child = spawn(binPath, args, {
    cwd: rootDir,
    env: { ...process.env },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess = child;
  serverStartTime = Date.now();
  stoppingRequestedAt = 0;

  child.stdout?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (!msg) return;
    logger.info({ source: 'factorio' }, msg);
    try { appendFileSync(logPath, msg + '\n', 'utf-8'); } catch {}
  });

  child.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (!msg) return;
    logger.error({ source: 'factorio' }, msg);
    try { appendFileSync(logPath, msg + '\n', 'utf-8'); } catch {}
  });

  child.on('error', (err: Error) => {
    logger.error({ err }, 'Factorio 进程启动失败');
    lastExitError = err.message;
    try { appendFileSync(logPath, `[ERROR] 启动失败: ${err.message}\n`, 'utf-8'); } catch {}
    serverProcess = null;
    invalidateCache();
  });

  child.on('exit', (code: number | null, signal: string | null) => {
    lastExitCode = code;
    lastExitSignal = signal;
    if (code !== 0) {
      const msg = `[ERROR] Factorio 进程异常退出 (code=${code}, signal=${signal})`;
      lastExitError = msg;
      logger.error({ exitCode: code, signal }, msg);
      try { appendFileSync(logPath, msg + '\n', 'utf-8'); } catch {}
    } else {
      lastExitError = '';
      lastExitCode = null;
      lastExitSignal = null;
      logger.info({ exitCode: code }, 'Factorio 进程已退出');
    }
    serverProcess = null;
    serverStartTime = 0;
    invalidateCache();
  });

  child.on('close', (code: number | null, signal: string | null) => {
    logger.info({ exitCode: code, signal }, 'Factorio 进程已关闭');
  });

  child.unref();

  setTimeout(() => resetLogWatcher(logPath), 1000);

  invalidateCache();

  return {
    message: '服务器正在启动，请稍候...',
    processRunning: true,
  };
}

export async function stopServer(): Promise<{ message: string }> {
  stoppingRequestedAt = Date.now();

  const running = await checkRconRunning();
  if (!running && (!serverProcess || serverProcess.exitCode !== null)) {
    const killed = killFactorioProcess();
    serverProcess = null;
    serverStartTime = 0;
    if (killed) {
      runningCache.set('rcon', { value: false, timestamp: Date.now() });
      invalidateCache();
      return { message: '服务器进程已终止' };
    }
    return { message: '服务器未在运行' };
  }

  if (running) {
    const pool = getRconPool();
    try {
      await pool.execute('/server-save');
      logger.info('服务器存档已保存，正在发送退出命令...');

      try {
        await pool.execute('/quit');
        logger.info('退出命令已通过 RCON 发送');
      } catch (rconError) {
        logger.warn({ err: rconError }, 'RCON 发送 /quit 失败，尝试使用 SIGTERM');
        if (serverProcess && serverProcess.exitCode === null) {
          serverProcess.kill('SIGTERM');
        } else {
          killFactorioProcess();
        }
      }
    } catch (saveError) {
      logger.warn({ err: saveError }, '/server-save 失败，直接发送退出命令');
      try {
        await pool.execute('/quit');
      } catch {
        if (serverProcess && serverProcess.exitCode === null) {
          serverProcess.kill('SIGTERM');
        } else {
          killFactorioProcess();
        }
      }
    }
  } else if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill('SIGTERM');
  }

  serverProcess = null;
  serverStartTime = 0;
  runningCache.set('rcon', { value: false, timestamp: Date.now() });
  invalidateCache();

  await waitForProcessExit(15000);

  return { message: '服务器已停止' };
}

async function waitForProcessExit(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const orphanPid = findOrphanFactorioPid();
    if (!orphanPid) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  killFactorioProcess();
}

function killFactorioProcess(): boolean {
  try {
    const stdout = execSync('pgrep -f "factorio.*--start-server"', { timeout: 3000 }).toString().trim();
    if (!stdout) return false;
    const pids = stdout.split('\n').map(s => s.trim()).filter(Boolean);
    for (const pid of pids) {
      try {
        process.kill(parseInt(pid, 10), 'SIGTERM');
        logger.info({ pid }, '已发送 SIGTERM 到 Factorio 进程');
      } catch { /* skip */ }
    }
    return pids.length > 0;
  } catch {
    return false;
  }
}

export async function restartServer(): Promise<{ message: string }> {
  await stopServer();

  await new Promise(resolve => setTimeout(resolve, 5000));

  try {
    const running = await checkRconRunning();
    if (running) {
      return { message: '服务器仍在运行，请先手动停止' };
    }

    const savesDir = resolveSavesDir();
    const saves = existsSync(savesDir)
      ? readdirSync(savesDir).filter(f => f.endsWith('.zip'))
      : [];

    if (saves.length === 0) {
      return { message: '没有找到存档文件，无法自动重启' };
    }

    const configDir = resolveConfigDir();
    const configFile = existsSync(path.join(configDir, 'server-settings.json'))
      ? 'server-settings.json'
      : undefined;

    const result = await startServer(serverVersion || undefined, saves[0], configFile);
    return { message: result.message };
  } catch (e) {
    const err = e as { message: string };
    throw new AppError(`重启失败: ${err.message}`, 500);
  }
}

export async function saveGame(): Promise<{ message: string }> {
  const pool = getRconPool();
  const response = await pool.execute('/server-save');

  if (response) {
    return { message: '保存成功' };
  }
  return { message: '保存命令已发送' };
}

export async function sendConsole(command: string): Promise<string> {
  validateCommand(command);
  const pool = getRconPool();
  return pool.execute(command);
}

export function invalidateCache(): void {
  runningCache.clear();
  closeRconPool();
}

export async function getSystemStats(): Promise<{
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
  online_players: number;
}> {
  const loadavg = os.loadavg();
  const cpuCount = os.cpus().length;
  const cpuPercent = Math.min(Math.round((loadavg[0] / cpuCount) * 100), 100);

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memoryPercent = Math.round(((totalMem - freeMem) / totalMem) * 100);

  let diskPercent = 0;
  try {
    const stdout = execSync('df -k /', { timeout: 5000 }).toString();
    const lines = stdout.trim().split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].trim().split(/\s+/);
      const used = parseInt(parts[2], 10);
      const available = parseInt(parts[3], 10);
      if (used + available > 0) {
        diskPercent = Math.round((used / (used + available)) * 100);
      }
    }
  } catch {
    diskPercent = 0;
  }

  let onlinePlayers = 0;
  try {
    const pool = getRconPool();
    const playersRes = await pool.execute('/players');
    if (playersRes) {
      const playerMatches = playersRes.matchAll(/(\S+)\s+\(online\)/gi);
      onlinePlayers = [...playerMatches].length;
    }
  } catch {
    onlinePlayers = 0;
  }

  return {
    cpu_percent: cpuPercent,
    memory_percent: memoryPercent,
    disk_percent: diskPercent,
    online_players: onlinePlayers,
  };
}
