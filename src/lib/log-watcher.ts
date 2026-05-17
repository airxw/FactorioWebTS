import { statSync, readFileSync, existsSync } from 'node:fs';
import { wsManager } from '../plugins/websocket.js';
import { logger } from './logger.js';
import { resolveLogPath } from './paths.js';

interface LogEntry {
  time: string;
  type: string;
  level: string;
  message: string;
  raw: string;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastSize = 0;
let lastIno = 0;
let currentLogPath = '';

function parseLogLine(line: string): LogEntry | null {
  const timestampMatch = line.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
  const time = timestampMatch ? timestampMatch[1] : '';

  let type = 'system';
  let level = 'INFO';
  let message = line;

  if (line.includes('[CHAT]')) {
    type = 'chat';
    message = line.replace(/.*?\[CHAT\]\s*/, '');
  } else if (line.includes('joined the game')) {
    type = 'login';
  } else if (line.includes('left the game')) {
    type = 'logout';
  } else if (line.includes('[ERROR]') || /\bError\b/.test(line)) {
    type = 'error';
    level = 'ERROR';
  } else if (line.includes('[WARNING]') || /\bWarning\b/.test(line)) {
    type = 'error';
    level = 'WARN';
  } else if (line.match(/Saving (game|map)/)) {
    type = 'save';
  }

  return { time, type, level, message, raw: line };
}

function checkLogFile(): void {
  if (!currentLogPath || !existsSync(currentLogPath)) return;

  try {
    const stat = statSync(currentLogPath);

    if (stat.ino !== lastIno) {
      lastSize = 0;
      lastIno = stat.ino;
    }

    if (stat.size <= lastSize) {
      lastSize = stat.size;
      return;
    }

    const newContent = readFileSync(currentLogPath, 'utf-8').slice(lastSize);
    lastSize = stat.size;

    const lines = newContent.split('\n').filter((l) => l.trim());
    let sent = 0;

    for (const line of lines) {
      const entry = parseLogLine(line);
      if (entry) {
        wsManager.broadcast('log', entry);
        sent++;
      }
    }

    if (sent > 0) {
      logger.info({ count: sent }, '广播日志条目');
    }
  } catch {
    // 文件可能正在写入，忽略读取错误
  }
}

export function startLogWatcher(): void {
  currentLogPath = resolveLogPath();

  if (!currentLogPath) {
    logger.warn('无法确定日志路径，日志监控将在服务器启动时自动激活');
    return;
  }

  if (existsSync(currentLogPath)) {
    const stat = statSync(currentLogPath);
    lastIno = stat.ino;
    lastSize = stat.size;
  }

  pollTimer = setInterval(checkLogFile, 2000);

  logger.info({ logPath: currentLogPath }, '日志文件监控已启动');
}

export function stopLogWatcher(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function resetLogWatcher(newLogPath: string): void {
  stopLogWatcher();

  currentLogPath = newLogPath;
  lastSize = 0;
  lastIno = 0;

  if (existsSync(newLogPath)) {
    const stat = statSync(newLogPath);
    lastIno = stat.ino;
    lastSize = stat.size;
  }

  pollTimer = setInterval(checkLogFile, 2000);

  logger.info({ logPath: newLogPath }, '日志监控已切换');
}
