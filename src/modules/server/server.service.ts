import os from 'os';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getRconPool, closeRconPool } from '../../lib/rcon.js';
import { sendGameCommand } from '../../lib/game-command-bus.js';
import { AppError } from '../../types/index.js';
import { logger } from '../../lib/logger.js';
import { wsManager } from '../../plugins/websocket.js';
import { resetLogWatcher } from '../../lib/log-watcher.js';
import {
  resolveLogPath,
  resolveConfigDir,
  resolveSavesDir,
  findFactorioBinary,
} from '../../lib/paths.js';

export const ServerState = {
  UNKNOWN: 'unknown',
  OFF: 'off',
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  ERROR: 'error',
} as const;

export type ServerStateValue = (typeof ServerState)[keyof typeof ServerState];

const BLOCKED_COMMANDS = [/shutdown/i, /quit/i, /exit/i, /^lua\s*=/i];
const MAX_COMMAND_LENGTH = 500;
const RCON_READY_POLL_MS = 2000;
const RCON_READY_TIMEOUT_MS = 60000;
const PROCESS_EXIT_TIMEOUT_MS = 20000;

let state: ServerStateValue = ServerState.UNKNOWN;
let serverProcess: ChildProcess | null = null;
let serverStartTime = 0;
let serverVersion = '';
let serverLogPath = '';
let lastExitCode: number | null = null;
let lastExitSignal: string | null = null;
let lastExitError = '';
let currentSaveName = '';
let currentConfigName = '';
let stoppingRequestedAt = 0;

function setState(newState: ServerStateValue): void {
  const prev = state;
  if (prev === newState) return;

  const allowed: Record<ServerStateValue, ServerStateValue[]> = {
    [ServerState.UNKNOWN]: [ServerState.OFF, ServerState.RUNNING, ServerState.STARTING, ServerState.STOPPING, ServerState.ERROR],
    [ServerState.OFF]: [ServerState.STARTING],
    [ServerState.STARTING]: [ServerState.RUNNING, ServerState.ERROR, ServerState.OFF],
    [ServerState.RUNNING]: [ServerState.STOPPING, ServerState.ERROR],
    [ServerState.STOPPING]: [ServerState.OFF, ServerState.ERROR],
    [ServerState.ERROR]: [ServerState.OFF, ServerState.STARTING],
  };

  if (!allowed[prev]?.includes(newState)) {
    logger.warn({ from: prev, to: newState }, '[Server] Invalid state transition blocked');
    return;
  }

  state = newState;
  logger.info({ from: prev, to: newState }, '[Server] State changed');
  broadcastState();
}

function broadcastState(): void {
  wsManager.broadcast('server_state', {
    state,
    version: serverVersion,
    saveName: currentSaveName,
    configName: currentConfigName,
    lastExitCode,
    lastExitSignal,
    lastExitError,
    startTime: serverStartTime,
  }, true);
}

export function getServerState(): {
  state: ServerStateValue;
  version: string;
  saveName: string;
  configName: string;
  startTime: number;
  lastExitCode: number | null;
  lastExitError: string;
} {
  return {
    state,
    version: serverVersion,
    saveName: currentSaveName,
    configName: currentConfigName,
    startTime: serverStartTime,
    lastExitCode,
    lastExitError,
  };
}

function validateCommand(command: string): void {
  if (!command || typeof command !== 'string') {
    throw new AppError('Command cannot be empty', 400);
  }
  if (command.length > MAX_COMMAND_LENGTH) {
    throw new AppError(`Command too long (max ${MAX_COMMAND_LENGTH} chars)`, 400);
  }
  if (/[;\r\n\x00]/.test(command)) {
    throw new AppError('Command contains illegal characters', 400);
  }
  for (const pattern of BLOCKED_COMMANDS) {
    if (pattern.test(command)) {
      throw new AppError('This command is blocked', 403);
    }
  }
}

function findFactorioPid(): number | null {
  try {
    const stdout = execSync('pgrep -f "factorio.*--start-server"', { timeout: 2000 })
      .toString()
      .trim();
    if (!stdout) return null;
    return parseInt(stdout.split('\n')[0].trim(), 10);
  } catch {
    return null;
  }
}

function killAllFactorioProcesses(): boolean {
  try {
    const stdout = execSync('pgrep -f "factorio.*--start-server"', { timeout: 3000 })
      .toString()
      .trim();
    if (!stdout) return false;
    const pids = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    for (const pid of pids) {
      try {
        process.kill(parseInt(pid, 10), 'SIGTERM');
        logger.info({ pid }, 'Sent SIGTERM to Factorio process');
      } catch {}
    }
    return pids.length > 0;
  } catch {
    return false;
  }
}

async function waitForProcessExit(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pid = findFactorioPid();
    if (!pid) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  killAllFactorioProcesses();
}

function attachProcessListeners(child: ChildProcess, logPath: string): void {
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
    logger.error({ err }, 'Factorio process start failed');
    lastExitError = err.message;
    try { appendFileSync(logPath, `[ERROR] Start failed: ${err.message}\n`, 'utf-8'); } catch {}
    serverProcess = null;
    serverStartTime = 0;
    setState(ServerState.ERROR);
  });

  child.on('exit', (code: number | null, signal: string | null) => {
    lastExitCode = code;
    lastExitSignal = signal;
    if (code !== 0) {
      const msg = `[ERROR] Factorio process exited abnormally (code=${code}, signal=${signal})`;
      lastExitError = msg;
      logger.error({ exitCode: code, signal }, msg);
      try { appendFileSync(logPath, msg + '\n', 'utf-8'); } catch {}
      setState(ServerState.ERROR);
    } else {
      lastExitError = '';
      lastExitCode = null;
      lastExitSignal = null;
      logger.info({ exitCode: code }, 'Factorio process exited');
      setState(ServerState.OFF);
    }
    serverProcess = null;
    serverStartTime = 0;
  });

  child.on('close', (code: number | null, signal: string | null) => {
    logger.info({ exitCode: code, signal }, 'Factorio process closed');
  });
}

async function waitForRconReady(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await sendGameCommand('/version');
    if (result.ok && result.value.length > 0 && !result.value.toLowerCase().includes('error')) {
      return true;
    }
    await new Promise((r) => setTimeout(r, RCON_READY_POLL_MS));
  }
  return false;
}

async function tryDetectRunning(): Promise<void> {
  const result = await sendGameCommand('/version');
  if (result.ok && result.value.length > 0 && !result.value.toLowerCase().includes('error')) {
    const vm = result.value.match(/Version:\s*([\d.]+)/i);
    if (vm) serverVersion = vm[1];
    serverStartTime = serverStartTime || Date.now();
    setState(ServerState.RUNNING);
    return;
  }

  const pid = findFactorioPid();
  if (pid) {
    setState(ServerState.STARTING);
    const ready = await waitForRconReady(RCON_READY_TIMEOUT_MS);
    if (ready) {
      setState(ServerState.RUNNING);
    }
    return;
  }

  setState(ServerState.OFF);
}

export async function isRunning(): Promise<boolean> {
  if (state === ServerState.UNKNOWN) {
    await tryDetectRunning();
  }
  return state === ServerState.RUNNING || state === ServerState.STARTING;
}

export function getServerProcessInfo(): {
  pid: number | null;
  state: ServerStateValue;
  startTime: number;
  version: string;
  logPath: string;
} {
  const pid = serverProcess?.pid ?? findFactorioPid();
  return { pid, state, startTime: serverStartTime, version: serverVersion, logPath: serverLogPath };
}

export async function getStatus(): Promise<{
  running: boolean;
  state: ServerStateValue;
  version: string;
  players: string[];
  playerCount: number;
  pid: number | null;
  uptime: number;
  logPath: string;
  lastExitCode: number | null;
  lastExitSignal: string | null;
  lastExitError: string;
}> {
  if (state === ServerState.UNKNOWN) {
    await tryDetectRunning();
  }

  const running = state === ServerState.RUNNING;
  const procInfo = getServerProcessInfo();
  const players: string[] = [];
  let playerCount = 0;
  let version = serverVersion || 'unknown';

  if (running) {
    const versionRes = await sendGameCommand('/version');
    if (versionRes.ok) {
      const versionMatch = versionRes.value.match(/Version:\s*([\d.]+)/i);
      if (versionMatch) version = versionMatch[1];
    }

    const playersRes = await sendGameCommand('/players');
    if (playersRes.ok && playersRes.value) {
      for (const m of playersRes.value.matchAll(/(\S+)\s+\(online\)/gi)) {
        players.push(m[1]);
      }
      playerCount = players.length;
    }
  }

  const uptime = procInfo.startTime > 0 ? Math.floor((Date.now() - procInfo.startTime) / 1000) : 0;

  return {
    running,
    state,
    version,
    players,
    playerCount,
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
): Promise<{ message: string }> {
  if (state === ServerState.UNKNOWN) await tryDetectRunning();

  if (state === ServerState.RUNNING) {
    return { message: 'Server is already running' };
  }
  if (state === ServerState.STARTING) {
    return { message: 'Server is starting, please wait...' };
  }
  if (state === ServerState.STOPPING) {
    return { message: 'Server is stopping, please try again later' };
  }

  if (serverProcess && serverProcess.exitCode === null) {
    return { message: 'Server process already exists' };
  }

  const orphan = findFactorioPid();
  if (orphan) {
    serverStartTime = serverStartTime || Date.now();
    setState(ServerState.STARTING);
    const ready = await waitForRconReady(RCON_READY_TIMEOUT_MS);
    if (ready) {
      setState(ServerState.RUNNING);
      return { message: 'Server is already running (detected existing process)' };
    }
    setState(ServerState.ERROR);
    return { message: 'Detected orphan process but RCON unreachable, please stop first' };
  }

  const savesDir = resolveSavesDir();
  const configDir = resolveConfigDir();

  if (!map) throw new AppError('Please select a save file', 400);

  const savePath = path.join(savesDir, map);
  if (!existsSync(savePath)) throw new AppError(`Save file not found: ${map}`, 400);

  const serverSettingsFile = config || 'server-settings.json';
  const serverSettingsPath = path.join(configDir, serverSettingsFile);
  if (!existsSync(serverSettingsPath))
    throw new AppError(`Server config not found: ${serverSettingsFile}`, 400);

  const { binPath, rootDir } = findFactorioBinary(version);

  let rconPort = 0;
  let rconPassword = '';
  try {
    const raw = readFileSync(serverSettingsPath, 'utf-8');
    const settings = JSON.parse(raw);
    rconPort = parseInt(settings.rcon_port || settings['rcon-port'] || '0', 10);
    rconPassword = settings.rcon_password || settings['rcon-password'] || '';
  } catch {}

  const args = ['--start-server', savePath, '--server-settings', serverSettingsPath];
  if (rconPort > 0 && rconPort <= 65535 && rconPassword) {
    args.push('--rcon-port', String(rconPort));
    args.push('--rcon-password', rconPassword);
  }

  const logPath = resolveLogPath(version);
  const logDir = path.dirname(logPath);
  try { mkdirSync(logDir, { recursive: true }); } catch {}

  currentSaveName = map;
  currentConfigName = serverSettingsFile;
  serverVersion = version || '';
  serverLogPath = logPath;
  stoppingRequestedAt = 0;

  setState(ServerState.STARTING);

  logger.info({ binPath, args, cwd: rootDir, logPath }, 'Starting Factorio server');

  const child = spawn(binPath, args, {
    cwd: rootDir,
    env: { ...process.env },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess = child;
  serverStartTime = Date.now();
  attachProcessListeners(child, logPath);
  child.unref();

  setTimeout(() => resetLogWatcher(logPath), 1000);

  closeRconPool();

  const ready = await waitForRconReady(RCON_READY_TIMEOUT_MS);
  if (ready) {
    setState(ServerState.RUNNING);
    return { message: 'Server started successfully' };
  }

  if (state === ServerState.ERROR) {
    return { message: 'Server start failed: ' + lastExitError };
  }

  logger.warn({ host: '127.0.0.1' }, 'Server started but RCON not ready yet');
  return { message: 'Server process started, waiting for RCON...' };
}

export async function stopServer(): Promise<{ message: string }> {
  if (state === ServerState.UNKNOWN) await tryDetectRunning();

  if (state === ServerState.OFF) {
    return { message: 'Server is not running' };
  }
  if (state === ServerState.STOPPING) {
    return { message: 'Server is stopping...' };
  }

  stoppingRequestedAt = Date.now();
  setState(ServerState.STOPPING);

  let graceful = false;

  try {
    await sendGameCommand('/server-save');
    logger.info('Server save completed');
    await sendGameCommand('/quit');
    logger.info('Quit command sent via RCON, waiting for process to exit');
    graceful = true;
  } catch {
    logger.warn('RCON graceful shutdown failed, attempting SIGTERM');
  }

  if (!graceful) {
    if (serverProcess && serverProcess.exitCode === null) {
      serverProcess.kill('SIGTERM');
    } else {
      killAllFactorioProcesses();
    }
  }

  await waitForProcessExit(PROCESS_EXIT_TIMEOUT_MS);

  const remaining = findFactorioPid();
  if (remaining) {
    logger.warn({ pid: remaining }, 'Process did not respond to SIGTERM, forcing kill');
    killAllFactorioProcesses();
    await new Promise((r) => setTimeout(r, 3000));
  }

  serverProcess = null;
  serverStartTime = 0;
  currentSaveName = '';
  currentConfigName = '';
  closeRconPool();
  setState(ServerState.OFF);

  return { message: 'Server stopped' };
}

export async function restartServer(): Promise<{ message: string }> {
  if (state === ServerState.UNKNOWN) await tryDetectRunning();

  if (state !== ServerState.RUNNING) {
    return { message: 'Server is not running, cannot restart' };
  }

  const savedVersion = serverVersion;
  const savedMap = currentSaveName;
  const savedConfig = currentConfigName;

  const stopResult = await stopServer();
  logger.info({ stopResult: stopResult.message }, 'Restart: stop completed');

  await new Promise((r) => setTimeout(r, 2000));

  if (state === ServerState.OFF) {
    const mapToStart = savedMap || (() => {
      const savesDir = resolveSavesDir();
      const saves = existsSync(savesDir)
        ? readdirSync(savesDir).filter((f) => f.endsWith('.zip'))
        : [];
      return saves[0] || undefined;
    })();

    if (!mapToStart) {
      setState(ServerState.ERROR);
      return { message: 'No save file found, cannot auto-restart' };
    }

    try {
      return (await startServer(savedVersion || undefined, mapToStart, savedConfig || undefined)).message
        ? { message: 'Server is restarting...' }
        : { message: 'Server restarted successfully' };
    } catch (e) {
      const err = e as { message: string };
      throw new AppError(`Restart failed: ${err.message}`, 500);
    }
  }

  return { message: 'Server state abnormal during restart' };
}

export async function saveGame(): Promise<{ message: string }> {
  const result = await sendGameCommand('/server-save');
  if (result.ok) return { message: 'Save successful' };
  return { message: 'Save command sent' };
}

export async function sendConsole(command: string): Promise<string> {
  validateCommand(command);
  const result = await sendGameCommand(command);
  return result.ok ? result.value : '';
}

export function invalidateCache(): void {
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
    const result = await sendGameCommand('/players');
    if (result.ok && result.value) {
      const playerMatches = result.value.matchAll(/(\S+)\s+\(online\)/gi);
      onlinePlayers = [...playerMatches].length;
    }
  } catch {
    onlinePlayers = 0;
  }

  return { cpu_percent: cpuPercent, memory_percent: memoryPercent, disk_percent: diskPercent, online_players: onlinePlayers };
}