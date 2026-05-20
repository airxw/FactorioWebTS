import { copyFileSync, readdirSync, unlinkSync, statSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { getDb, closeDb } from '../../lib/database.js';
import { loadEnv } from '../../config/env.js';
import { AppError } from '../../types/index.js';
import { MAX_BACKUP_COUNT } from '../../config/constants.js';
import { logger } from '../../lib/logger.js';

function getBackupDir(): string {
  const env = loadEnv();
  const dbPath = path.resolve(env.DB_PATH);
  return path.join(path.dirname(dbPath), '.db-backups');
}

export interface BackupInfo {
  filename: string;
  timestamp: string;
  created_at: string;
  size: number;
}

export function createBackup(): BackupInfo {
  const env = loadEnv();
  const dbPath = path.resolve(env.DB_PATH);

  if (!existsSync(dbPath)) {
    throw new AppError('数据库文件不存在', 404);
  }

  const backupDir = getBackupDir();
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFilename = `backup-${timestamp}.db`;
  const backupPath = path.join(backupDir, backupFilename);

  const db = getDb();
  db.backup(backupPath);

  const stat = statSync(backupPath);

  cleanupOldBackups();

  logger.info({ filename: backupFilename, size: stat.size }, '[Backup] Database backup created');

  return {
    filename: backupFilename,
    timestamp,
    created_at: new Date().toISOString(),
    size: stat.size,
  };
}

export function listBackups(): BackupInfo[] {
  const backupDir = getBackupDir();
  if (!existsSync(backupDir)) return [];

  return readdirSync(backupDir)
    .filter(f => f.startsWith('backup-') && f.endsWith('.db'))
    .map(f => {
      const filePath = path.join(backupDir, f);
      try {
        const stat = statSync(filePath);
        return {
          filename: f,
          timestamp: f.replace('backup-', '').replace('.db', ''),
          created_at: stat.birthtime.toISOString(),
          size: stat.size,
        };
      } catch {
        return null;
      }
    })
    .filter((b): b is BackupInfo => b !== null)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function restoreBackup(filename: string): void {
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new AppError('无效的备份文件名', 400);
  }

  const backupDir = getBackupDir();
  const backupPath = path.join(backupDir, filename);

  if (!existsSync(backupPath)) {
    throw new AppError('备份文件不存在', 404);
  }

  const env = loadEnv();
  const dbPath = path.resolve(env.DB_PATH);

  const safetyFilename = `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
  const safetyPath = path.join(backupDir, safetyFilename);

  const db = getDb();
  db.backup(safetyPath);

  closeDb();

  try {
    copyFileSync(backupPath, dbPath);
    logger.info({ filename, restoredFrom: backupPath }, '[Backup] Database restored');
  } catch (e) {
    try {
      copyFileSync(safetyPath, dbPath);
    } catch {}
    throw new AppError('恢复备份失败', 500);
  }

  try {
    const verifyDb = getDb();
    verifyDb.prepare('SELECT count(*) as cnt FROM migrations').get();
    logger.info('[Backup] Database restored and verified successfully');
  } catch (e) {
    throw new AppError('恢复的数据库验证失败', 500);
  }
}

export function deleteBackup(filename: string): void {
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new AppError('无效的备份文件名', 400);
  }

  const backupDir = getBackupDir();
  const backupPath = path.join(backupDir, filename);

  if (!existsSync(backupPath)) {
    throw new AppError('备份文件不存在', 404);
  }

  unlinkSync(backupPath);
  logger.info({ filename }, '[Backup] Backup deleted');
}

function cleanupOldBackups(): number {
  const backups = listBackups();
  if (backups.length <= MAX_BACKUP_COUNT) return 0;

  const toDelete = backups.slice(MAX_BACKUP_COUNT);
  const backupDir = getBackupDir();
  let deleted = 0;

  for (const bk of toDelete) {
    try {
      unlinkSync(path.join(backupDir, bk.filename));
      deleted++;
    } catch {}
  }

  return deleted;
}
