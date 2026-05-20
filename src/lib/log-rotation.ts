import { existsSync, statSync, readdirSync, renameSync, unlinkSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { MAX_LOG_SIZE, MAX_LOG_FILES } from '../config/constants.js';
import { logger } from './logger.js';

function getLogDir(): string {
  return path.resolve(process.cwd(), 'logs');
}

function getMainLogPath(): string {
  return path.join(getLogDir(), 'app.log');
}

export function checkAndRotate(): void {
  const logPath = getMainLogPath();
  if (!existsSync(logPath)) return;

  try {
    const stat = statSync(logPath);
    if (stat.size < MAX_LOG_SIZE) return;

    const logDir = getLogDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rotatedName = `app-${timestamp}.log`;
    const rotatedPath = path.join(logDir, rotatedName);

    renameSync(logPath, rotatedPath);
    cleanupOldRotatedLogs();

    logger.info({ rotatedTo: rotatedName }, '[LogRotation] Log file rotated');
  } catch (e) {
    logger.warn({ err: e }, '[LogRotation] Failed to rotate log file');
  }
}

function cleanupOldRotatedLogs(): void {
  const logDir = getLogDir();
  if (!existsSync(logDir)) return;

  const rotatedFiles = readdirSync(logDir)
    .filter(f => f.startsWith('app-') && f.endsWith('.log'))
    .sort()
    .reverse();

  if (rotatedFiles.length <= MAX_LOG_FILES) return;

  const toDelete = rotatedFiles.slice(MAX_LOG_FILES);
  for (const f of toDelete) {
    try {
      unlinkSync(path.join(logDir, f));
    } catch {}
  }
}

export function startLogRotationCheck(intervalMs: number = 60000): NodeJS.Timeout {
  if (!existsSync(getLogDir())) {
    mkdirSync(getLogDir(), { recursive: true });
  }
  return setInterval(checkAndRotate, intervalMs);
}
