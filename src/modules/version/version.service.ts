import { getDb } from '../../lib/database.js';
import * as repo from './version.repository.js';
import { resolveFactorioRoot } from '../../lib/paths.js';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { AppError } from '../../types/index.js';

const installProgressMap = new Map<string, { progress: number; status: string }>();

function getFactorioPath(): string {
  return resolveFactorioRoot();
}

function resolveVersionBinary(version: string): string | null {
  const factorioPath = getFactorioPath();
  const candidate = path.resolve(factorioPath, 'versions', version, 'bin', 'x64', 'factorio');
  if (existsSync(candidate)) return candidate;
  return null;
}

function resolveVersionsDir(): string {
  const factorioPath = getFactorioPath();
  const candidate = path.resolve(factorioPath, 'versions');
  if (existsSync(candidate)) return candidate;
  return candidate;
}

export function listAllVersions() {
  const db = getDb();
  const dbVersions = repo.listVersions(db);
  const current = repo.getCurrentVersion(db);

  const versionsDir = resolveVersionsDir();
  const fsVersions: string[] = [];

  if (existsSync(versionsDir)) {
    for (const entry of readdirSync(versionsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && /^\d+\.\d+\.\d+$/.test(entry.name)) {
        fsVersions.push(entry.name);
      }
    }
  }

  const result = dbVersions.map((v) => ({
    version: v.version,
    release_type: v.release_type,
    is_current: Boolean(v.is_current),
    installed_at: v.installed_at,
    file_size: v.file_size,
    sha256: v.sha256,
    is_installed: true,
  }));

  for (const fsVer of fsVersions) {
    if (!dbVersions.find((v) => v.version === fsVer)) {
      result.push({
        version: fsVer,
        release_type: 'stable',
        is_current: false,
        installed_at: 0,
        file_size: 0,
        sha256: '',
        is_installed: true,
      });
    }
  }

  if (current && !result.find((v) => v.version === current.version && v.is_current)) {
    const currentEntry = result.find((v) => v.version === current.version);
    if (currentEntry) currentEntry.is_current = true;
  }

  return result;
}

export function getCurrentVersion() {
  const db = getDb();
  const current = repo.getCurrentVersion(db);
  if (current) {
    return {
      version: current.version,
      release_type: current.release_type,
      is_current: true,
      installed_at: current.installed_at,
      file_size: current.file_size,
      sha256: current.sha256,
    };
  }

  return { version: '', release_type: 'stable', is_current: false, installed_at: 0, file_size: 0, sha256: '' };
}

export async function getLatestVersion(releaseType = 'stable') {
  try {
    const resp = await fetch('https://factorio.com/api/latest-releases');
    const data = (await resp.json()) as Record<string, { headless?: string }>;
    const key = releaseType === 'experimental' ? 'experimental' : 'stable';
    const version = data[key]?.headless || '';
    const current = getCurrentVersion();
    return {
      version,
      release_type: key,
      has_update: version !== '' && version !== current.version,
      current_version: current.version,
    };
  } catch {
    const current = getCurrentVersion();
    return {
      version: current.version,
      release_type: releaseType,
      has_update: false,
      current_version: current.version,
    };
  }
}

export async function getAllLatestVersions() {
  try {
    const resp = await fetch('https://factorio.com/api/latest-releases');
    const data = (await resp.json()) as Record<string, { headless?: string }>;
    const current = getCurrentVersion();
    
    const stableVersion = data.stable?.headless || '';
    const experimentalVersion = data.experimental?.headless || '';
    
    return {
      stable: {
        version: stableVersion,
        release_type: 'stable',
        has_update: stableVersion !== '' && stableVersion !== current.version,
      },
      experimental: {
        version: experimentalVersion,
        release_type: 'experimental',
        has_update: experimentalVersion !== '' && experimentalVersion !== current.version,
      },
      current_version: current.version,
    };
  } catch {
    const current = getCurrentVersion();
    return {
      stable: {
        version: current.version,
        release_type: 'stable',
        has_update: false,
      },
      experimental: {
        version: current.version,
        release_type: 'experimental',
        has_update: false,
      },
      current_version: current.version,
    };
  }
}

export function installVersion(version: string, releaseType = 'stable'): void {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new AppError('版本号格式无效', 400);
  }

  const db = getDb();
  const existing = repo.findVersionByVersion(db, version);
  if (existing) throw new AppError('该版本已安装', 409);

  installProgressMap.set(version, { progress: 0, status: '初始化中' });

  const now = Math.floor(Date.now() / 1000);
  repo.createVersion(db, {
    version,
    release_type: releaseType,
    is_current: 0,
    backup_path: '',
    file_size: 0,
    sha256: '',
    installed_at: now,
  });

  installProgressMap.set(version, { progress: 100, status: '完成' });
}

export function setDefaultVersion(version: string): void {
  const db = getDb();
  const ver = repo.findVersionByVersion(db, version);
  if (!ver) throw new AppError('版本不存在', 404);

  repo.setAllVersionsNotCurrent(db);
  repo.updateVersionCurrent(db, ver.id, 1);
}

export function deleteVersionData(version: string): void {
  const db = getDb();
  const ver = repo.findVersionByVersion(db, version);
  if (!ver) throw new AppError('版本不存在', 404);
  if (ver.is_current) throw new AppError('不能删除当前版本', 400);

  repo.deleteVersion(db, ver.id);
}

export function verifyVersion(version: string): { valid: boolean; message: string } {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    return { valid: false, message: '版本号格式无效' };
  }

  const binPath = resolveVersionBinary(version);

  if (binPath) {
    return { valid: true, message: `版本 ${version} 已验证存在` };
  }

  return { valid: false, message: `版本 ${version} 的二进制文件不存在` };
}

export function getInstallProgress(version: string): { progress: number; status: string } {
  const progress = installProgressMap.get(version);
  if (!progress) {
    return { progress: 0, status: '未开始' };
  }
  return progress;
}
