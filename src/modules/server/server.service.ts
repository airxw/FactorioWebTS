import os from 'os';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getRconManager, closeRconManager } from '../../lib/rcon.js';
import { sendGameCommand, fireAndForget, setServerRunningState } from '../../lib/game-command-bus.js';
import { AppError } from '../../types/index.js';
import { logger } from '../../lib/logger.js';
import { wsManager } from '../../plugins/websocket.js';
import { resetLogWatcher } from '../../lib/log-watcher.js';
import { eventBus } from '../../lib/event-bus.js';
import { executeClaimCode } from '../cdk/cdk.service.js';
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
const PROCESS_EXIT_TIMEOUT_MS = 20000;
const RCON_STARTUP_RETRY_INTERVAL_MS = 2000;
const RCON_STARTUP_MAX_RETRIES = 30;

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
let rconConnectTimer: NodeJS.Timeout | null = null;

let cachedPlayers: string[] = [];
let cachedPlayerCount = 0;
let statusCacheTimer: NodeJS.Timeout | null = null;

function setState(newState: ServerStateValue): void {
  const prev = state;
  if (prev === newState) return;

  const allowed: Record<ServerStateValue, ServerStateValue[]> = {
    [ServerState.UNKNOWN]: [ServerState.OFF, ServerState.RUNNING, ServerState.STARTING, ServerState.STOPPING, ServerState.ERROR],
    [ServerState.OFF]: [ServerState.STARTING],
    [ServerState.STARTING]: [ServerState.RUNNING, ServerState.ERROR, ServerState.OFF, ServerState.STOPPING],
    [ServerState.RUNNING]: [ServerState.STOPPING, ServerState.ERROR],
    [ServerState.STOPPING]: [ServerState.OFF, ServerState.ERROR],
    [ServerState.ERROR]: [ServerState.OFF, ServerState.STARTING, ServerState.STOPPING],
  };

  if (!allowed[prev]?.includes(newState)) {
    logger.warn({ from: prev, to: newState }, '[Server] Invalid state transition blocked');
    return;
  }

  state = newState;
  logger.info({ from: prev, to: newState }, '[Server] State changed');
  broadcastState();

  setServerRunningState(
    state === ServerState.RUNNING,
    state === ServerState.STOPPING
  );

  if (state === ServerState.RUNNING) {
    startStatusPoller();
  } else {
    stopStatusPoller();
  }
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

function startStatusPoller(): void {
  if (statusCacheTimer) return;

  const poll = async () => {
    if (state !== ServerState.RUNNING) {
      statusCacheTimer = setTimeout(poll, 3000);
      return;
    }

    try {
      const playersRes = await sendGameCommand('/players');
      if (!playersRes.ok) {
        if (playersRes.error.code === 'NOT_CONNECTED' || playersRes.error.code === 'DISCONNECTED') {
          logger.warn({ error: playersRes.error }, '[Server] RCON heartbeat failed, reconnecting...');
          getRconManager().connect().catch((e) => {
            logger.warn({ err: e }, '[Server] RconManager reconnect failed');
          });
        }
      } else if (playersRes.value) {
        const players: string[] = [];
        for (const m of playersRes.value.matchAll(/(\S+)\s+\(online\)/gi)) {
          players.push(m[1]);
        }
        cachedPlayers = players;
        cachedPlayerCount = players.length;
      }
    } catch (e) {
      logger.debug('[RCON Cache] Failed to background poll players');
    }

    // 使用递归 setTimeout 而非 setInterval，确保上一次完成后才开始下一次，避免 RCON 超时时请求堆积
    if (state === ServerState.RUNNING) {
      statusCacheTimer = setTimeout(poll, 3000);
    }
  };

  statusCacheTimer = setTimeout(poll, 3000);
}

function stopStatusPoller(): void {
  if (statusCacheTimer) {
    clearTimeout(statusCacheTimer);
    statusCacheTimer = null;
  }
  cachedPlayers = [];
  cachedPlayerCount = 0;
}

function cancelRconConnectRetry(): void {
  if (rconConnectTimer) {
    clearTimeout(rconConnectTimer);
    rconConnectTimer = null;
  }
}

function scheduleRconConnectForStartup(): void {
  cancelRconConnectRetry();
  let attempts = 0;

  const tryConnect = () => {
    // 状态已不是 STARTING，停止重试
    if (state !== ServerState.STARTING) return;

    // 进程已退出，停止重试
    if (serverProcess && serverProcess.exitCode !== null) {
      logger.warn('[Server] Factorio process exited during RCON retry, stopping');
      if (state === ServerState.STARTING) {
        lastExitError = 'Factorio 进程在 RCON 连接期间退出';
        setState(ServerState.ERROR);
      }
      return;
    }

    attempts++;
    getRconManager().connect().then((res) => {
      if (res.ok) {
        setState(ServerState.RUNNING);
        sendGameCommand('/version').then((verRes) => {
          if (verRes.ok) {
            const versionMatch = verRes.value.match(/Version:\s*([\d.]+)/i);
            if (versionMatch) serverVersion = versionMatch[1];
          }
        }).catch(() => {});
        return;
      }

      if (attempts >= RCON_STARTUP_MAX_RETRIES) {
        logger.error({ attempts, error: res.error }, '[Server] RCON 连接重试已达上限，启动失败');
        lastExitError = `RCON 连接失败 (${res.error.code}: ${res.error.message})，已重试 ${attempts} 次`;
        setState(ServerState.ERROR);
        return;
      }

      logger.warn({ 
        attempt: attempts, 
        max: RCON_STARTUP_MAX_RETRIES,
        errorCode: res.error.code,
        errorMessage: res.error.message
      }, '[Server] RCON 连接失败，2秒后重试');
      rconConnectTimer = setTimeout(tryConnect, RCON_STARTUP_RETRY_INTERVAL_MS);
    }).catch((err) => {
      logger.warn({ attempt: attempts, max: RCON_STARTUP_MAX_RETRIES, err }, '[Server] RCON 连接异常，2秒后重试');
      if (attempts >= RCON_STARTUP_MAX_RETRIES) {
        logger.error({ attempts, err }, '[Server] RCON 连接重试已达上限，启动失败');
        lastExitError = `RCON 连接异常，已重试 ${attempts} 次`;
        setState(ServerState.ERROR);
        return;
      }

      rconConnectTimer = setTimeout(tryConnect, RCON_STARTUP_RETRY_INTERVAL_MS);
    });
  };

  // 首次延迟 1 秒，给 Factorio 进程一点启动时间
  rconConnectTimer = setTimeout(tryConnect, 1000);
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
    const stdout = execSync('pgrep -f "bin/x64/factorio\\s+--start-server"', { timeout: 2000 })
      .toString()
      .trim();
    if (!stdout) return null;
    return parseInt(stdout.split('\n')[0].trim(), 10);
  } catch {
    return null;
  }
}

function killAllFactorioProcesses(signal: NodeJS.Signals = 'SIGTERM'): boolean {
  try {
    const stdout = execSync('pgrep -f "bin/x64/factorio\\s+--start-server"', { timeout: 3000 })
      .toString()
      .trim();
    if (!stdout) return false;
    const pids = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    for (const pid of pids) {
      try {
        process.kill(parseInt(pid, 10), signal);
        logger.info({ pid, signal }, 'Sent signal to Factorio process');
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
  killAllFactorioProcesses('SIGKILL');
}

function processStdoutLine(line: string): void {
  if (line.includes('[CHAT]')) {
    const chatIndex = line.indexOf('[CHAT]');
    const afterChat = line.substring(chatIndex + 6).trim();

    let player = '';
    let message = '';
    const angleMatch = afterChat.match(/^<([^>]+)>\s*(.*)/);
    if (angleMatch) {
      player = angleMatch[1];
      message = angleMatch[2];
    } else {
      const colonMatch = afterChat.match(/^([^:]+):\s*(.*)/);
      if (colonMatch) {
        player = colonMatch[1];
        message = colonMatch[2];
      }
    }

    if (!player) return;

    const timeMatch = line.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
    const time = timeMatch ? timeMatch[1] : '';

    logger.info({ player, message, time }, '[Stdout] Emit log:chat');
    eventBus.emit('log:chat', { player, message, raw: line, time });

    if (message.startsWith('!claim ') || message.startsWith('!提货 ')) {
      const code = message.substring(message.indexOf(' ') + 1);
      executeClaimCode(player, code);
    } else if (message === '!claim' || message === '!提货') {
      fireAndForget(`/w ${player} 用法: !claim <提货码>`);
    }
    return;
  }

  if (line.includes('[JOIN]') || line.includes('joined the game')) {
    const joinMatch = line.match(/(\S+)\s+joined the game/);
    if (joinMatch) {
      const playerName = joinMatch[1];
      const timeMatch = line.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
      const time = timeMatch ? timeMatch[1] : '';
      logger.info({ playerName, time }, '[Stdout] Emit log:login + player:join');
      eventBus.emit('log:login', { playerName, message: line, raw: line, time });
      eventBus.emit('player:join', { playerName });
    } else {
      logger.info({ line }, '[Stdout] matched JOIN pattern but no player name extracted');
    }
    return;
  }

  if (line.includes('[LEAVE]') || line.includes('left the game')) {
    const leaveMatch = line.match(/(\S+)\s+left the game/);
    if (leaveMatch) {
      const playerName = leaveMatch[1];
      const timeMatch = line.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
      const time = timeMatch ? timeMatch[1] : '';
      logger.info({ playerName, time }, '[Stdout] Emit log:logout + player:leave');
      eventBus.emit('log:logout', { playerName, message: line, raw: line, time });
      eventBus.emit('player:leave', { playerName });
    }
    return;
  }
}

function attachProcessListeners(child: ChildProcess): void {
  child.stdout?.on('data', (data: Buffer) => {
    const raw = data.toString();
    const msg = raw.trim();
    if (!msg) return;
    logger.info({ source: 'factorio' }, msg);

    const lines = raw.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) processStdoutLine(trimmed);
    }
  });

  child.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (!msg) return;
    logger.error({ source: 'factorio' }, msg);
  });

  child.on('error', (err: Error) => {
    logger.error({ err }, 'Factorio process start failed');
    lastExitError = err.message;
    serverProcess = null;
    serverStartTime = 0;
    setState(ServerState.ERROR);
  });

  child.on('exit', (code: number | null, signal: string | null) => {
    cancelRconConnectRetry();
    lastExitCode = code;
    lastExitSignal = signal;
    if (code !== 0 && stoppingRequestedAt === 0) {
      const msg = `Factorio process exited abnormally (code=${code}, signal=${signal})`;
      lastExitError = msg;
      logger.error({ exitCode: code, signal }, msg);
      setState(ServerState.ERROR);
    } else {
      if (code !== 0) {
        logger.warn({ exitCode: code, signal }, 'Factorio process exited during stop');
      } else {
        logger.info({ exitCode: code, signal }, 'Factorio process exited');
      }
      lastExitError = '';
      lastExitCode = null;
      lastExitSignal = null;
      setState(ServerState.OFF);
    }
    serverProcess = null;
    serverStartTime = 0;
  });

  child.on('close', (code: number | null, signal: string | null) => {
    logger.info({ exitCode: code, signal }, 'Factorio process closed');
  });
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
    getRconManager().connect().then((res) => {
      if (res.ok) {
        setState(ServerState.RUNNING);
      } else {
        logger.warn({ pid }, '[Server] Orphan factorio process found but RCON unreachable, killing and setting OFF');
        try { process.kill(pid, 'SIGTERM'); } catch {}
        setState(ServerState.OFF);
      }
    }).catch(() => {
      logger.warn({ pid }, '[Server] Orphan factorio process found but RCON unreachable, killing and setting OFF');
      try { process.kill(pid, 'SIGTERM'); } catch {}
      setState(ServerState.OFF);
    });
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

  const uptime = procInfo.startTime > 0 ? Math.floor((Date.now() - procInfo.startTime) / 1000) : 0;

  return {
    running,
    state,
    version: serverVersion || 'unknown',
    players: cachedPlayers,
    playerCount: cachedPlayerCount,
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
    currentConfigName = config || 'server-settings.json';
    setState(ServerState.STARTING);
    closeRconManager();
    getRconManager(currentConfigName);
    return getRconManager().connect().then((res) => {
      if (res.ok) {
        setState(ServerState.RUNNING);
        return { message: 'Server is already running (detected existing process)' };
      }
      lastExitError = 'Detected orphan process but RCON unreachable';
      setState(ServerState.ERROR);
      return { message: 'Detected orphan process but RCON unreachable, please stop first' };
    }).catch(() => {
      lastExitError = 'Detected orphan process but RCON unreachable';
      setState(ServerState.ERROR);
      return { message: 'Detected orphan process but RCON unreachable, please stop first' };
    });
  }

  currentSaveName = map || '';
  currentConfigName = config || 'server-settings.json';
  serverVersion = version || '';
  serverStartTime = Date.now();
  stoppingRequestedAt = 0;

  closeRconManager();
  getRconManager(currentConfigName);

  try {
    const savesDir = resolveSavesDir();
    const configDir = resolveConfigDir();

    if (!map) throw new AppError('Please select a save file', 400);

    const savePath = path.join(savesDir, map);
    if (!existsSync(savePath)) throw new AppError(`Save file not found: ${map}`, 400);

    const serverSettingsFile = config || 'server-settings.json';
    const serverSettingsPath = path.join(configDir, serverSettingsFile);
    if (!existsSync(serverSettingsPath))
      throw new AppError(`Server config not found: ${serverSettingsFile}`, 400);

    setState(ServerState.STARTING);

    const { binPath, rootDir } = findFactorioBinary(version);

    let rconPort = 0;
    let rconPassword = '';
    try {
      const raw = readFileSync(serverSettingsPath, 'utf-8');
      const settings = JSON.parse(raw);
      rconPort = parseInt(settings.rcon_port || settings['rcon-port'] || '0', 10);
      rconPassword = settings.rcon_password || settings['rcon-password'] || '';
    } catch {}

    if (!rconPort || rconPort <= 0 || rconPort > 65535 || !rconPassword) {
      throw new AppError(
        'RCON 未配置，无法管理服务器。请在 ' + serverSettingsFile + ' 中设置 rcon_port 和 rcon_password',
        400
      );
    }

    const args = [
      '--start-server', savePath,
      '--server-settings', serverSettingsPath,
      '--rcon-port', String(rconPort),
      '--rcon-password', rconPassword,
    ];

    const logPath = resolveLogPath(version);
    const logDir = path.dirname(logPath);
    try { mkdirSync(logDir, { recursive: true }); } catch {}

    serverLogPath = logPath;

    logger.info({ binPath, args, cwd: rootDir, logPath }, 'Starting Factorio server');

    const child = spawn(binPath, args, {
      cwd: rootDir,
      env: { ...process.env },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    serverProcess = child;
    attachProcessListeners(child);
    resetLogWatcher(logPath);

    scheduleRconConnectForStartup();

    logger.info({ binPath, rconPort }, 'Factorio process spawned, RCON manager connecting...');
    return { message: 'Server process spawned, waiting for startup...' };
  } catch (e) {
    if (e instanceof AppError && e.statusCode === 400) {
      setState(ServerState.OFF);
    } else {
      setState(ServerState.ERROR);
    }
    throw e;
  }
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
  cancelRconConnectRetry();
  setState(ServerState.STOPPING);

  let graceful = false;

  const saveRes = await sendGameCommand('/server-save');
  if (saveRes.ok) {
    logger.info('Server save completed');
    await new Promise((r) => setTimeout(r, 3000));
    const quitRes = await sendGameCommand('/quit');
    if (quitRes.ok) {
      logger.info('Quit command sent via RCON, waiting for process to exit');
      graceful = true;
    } else {
      logger.warn({ error: quitRes.error }, 'RCON /quit command failed, attempting SIGTERM');
    }
  } else {
    logger.warn({ error: saveRes.error }, 'RCON /server-save failed, attempting SIGTERM');
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
    logger.warn({ pid: remaining }, 'Process did not respond to SIGTERM, forcing kill with SIGKILL');
    killAllFactorioProcesses('SIGKILL');
    await new Promise((r) => setTimeout(r, 3000));
  }

  serverProcess = null;
  serverStartTime = 0;
  currentSaveName = '';
  currentConfigName = '';
  stoppingRequestedAt = 0;
  closeRconManager();
  const currentState = state as ServerStateValue;
  if (currentState === ServerState.STOPPING || currentState === ServerState.ERROR) {
    setState(ServerState.OFF);
  }

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

  const currentState: ServerStateValue = state as ServerStateValue;
  if (currentState === ServerState.OFF) {
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

export async function saveGame(): Promise<{ message: string; success: boolean }> {
  const result = await sendGameCommand('/server-save');
  if (result.ok) return { message: 'Save successful', success: true };
  return { message: `Save failed: ${result.error.message || result.error.code}`, success: false };
}

const CONSOLE_LOG_CAPTURE_WINDOW_MS = 5000;

let consoleCaptureTimer: NodeJS.Timeout | null = null;
let consoleCaptureHandler: ((payload: { message: string; raw: string; time: string }) => void) | null = null;

function startConsoleLogCapture(command: string): void {
  stopConsoleLogCapture();

  const capturedLines: string[] = [];

  consoleCaptureHandler = (payload) => {
    capturedLines.push(payload.message || payload.raw || '');
  };

  eventBus.on('log:system', consoleCaptureHandler);

  consoleCaptureTimer = setTimeout(() => {
    if (consoleCaptureHandler) {
      eventBus.off('log:system', consoleCaptureHandler);
      consoleCaptureHandler = null;
    }
    consoleCaptureTimer = null;

    if (capturedLines.length > 0) {
      wsManager.broadcast('console_response', {
        command,
        lines: capturedLines,
        captured: true,
      });
    }
  }, CONSOLE_LOG_CAPTURE_WINDOW_MS);
}

function stopConsoleLogCapture(): void {
  if (consoleCaptureTimer) {
    clearTimeout(consoleCaptureTimer);
    consoleCaptureTimer = null;
  }
  if (consoleCaptureHandler) {
    eventBus.off('log:system', consoleCaptureHandler);
    consoleCaptureHandler = null;
  }
}

export async function sendConsole(command: string): Promise<string> {
  validateCommand(command);
  const result = await sendGameCommand(command);
  startConsoleLogCapture(command);
  return result.ok ? result.value : '';
}

export function invalidateCache(): void {
  closeRconManager();
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

  let onlinePlayers = cachedPlayerCount;

  return { cpu_percent: cpuPercent, memory_percent: memoryPercent, disk_percent: diskPercent, online_players: onlinePlayers };
}

wsManager.onChannelSubscribe('server_state', (socket) => {
  const payload = JSON.stringify({
    channel: 'server_state',
    data: {
      state,
      version: serverVersion,
      saveName: currentSaveName,
      configName: currentConfigName,
      lastExitCode,
      lastExitSignal,
      lastExitError,
      startTime: serverStartTime,
    },
    timestamp: Date.now(),
  });
  if (socket.readyState === 1) {
    socket.send(payload);
  }
});