import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../config/env.js';
import { AppError } from '../types/index.js';
import { getDb } from './database.js';
import * as versionRepo from '../modules/version/version.repository.js';

export function resolveFactorioRoot(): string {
  const env = loadEnv();
  return env.FACTORIO_PATH || process.cwd();
}

function resolveVersionRoot(version?: string): string {
  const root = resolveFactorioRoot();
  if (!version) {
    try {
      const db = getDb();
      const current = versionRepo.getCurrentVersion(db);
      if (current) {
        const candidate = path.resolve(root, 'versions', current.version);
        if (existsSync(candidate)) return candidate;
      }
    } catch {}
    return root;
  }

  const candidate = path.resolve(root, 'versions', version);
  if (existsSync(candidate)) return candidate;

  return root;
}

export function resolveModsDir(): string {
  const env = loadEnv();
  if (env.MODS_PATH) return env.MODS_PATH;
  const root = resolveVersionRoot();
  return path.resolve(root, 'mods');
}

export function resolveLogPath(version?: string): string {
  const env = loadEnv();
  if (env.LOG_PATH) return env.LOG_PATH;

  const root = resolveVersionRoot(version);
  return path.resolve(root, 'factorio-current.log');
}

export function resolveLogsDir(): string {
  const env = loadEnv();
  if (env.LOGS_PATH) return env.LOGS_PATH;

  const root = resolveFactorioRoot();
  const logsDir = path.resolve(root, 'logs');
  if (existsSync(logsDir)) return logsDir;

  return root;
}

export function resolveConfigDir(): string {
  const env = loadEnv();
  if (env.CONFIG_PATH) return env.CONFIG_PATH;

  // 优先使用项目根目录下的 config/
  const projectConfig = path.resolve(process.cwd(), 'config');
  if (existsSync(projectConfig)) {
    return projectConfig;
  }

  const root = resolveFactorioRoot();
  return path.resolve(root, 'config');
}

export function resolveSavesDir(): string {
  const env = loadEnv();
  if (env.SAVES_PATH) return env.SAVES_PATH;

  const projectSaves = path.resolve(process.cwd(), 'data', 'saves');
  if (existsSync(projectSaves)) {
    return projectSaves;
  }

  return path.resolve(resolveFactorioRoot(), 'saves');
}

export function resolveDataDir(): string {
  const root = resolveVersionRoot();
  return path.resolve(root, 'data');
}

export function findFactorioBinary(version?: string): { binPath: string; rootDir: string } {
  const candidateRoots = version
    ? [path.resolve(resolveFactorioRoot(), 'versions', version)]
    : [resolveFactorioRoot()];

  for (const root of candidateRoots) {
    const candidate = path.join(root, 'bin', 'x64', 'factorio');
    if (existsSync(candidate)) {
      return { binPath: candidate, rootDir: root };
    }
  }

  throw new AppError(
    `Factorio${version ? ' ' + version : ''} 二进制文件不存在，已尝试: ${candidateRoots.map(r => path.join(r, 'bin', 'x64', 'factorio')).join(', ')}`,
    400
  );
}
