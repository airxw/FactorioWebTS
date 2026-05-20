import { getDb } from '../../lib/database.js';
import * as repo from './version.repository.js';
import { resolveFactorioRoot } from '../../lib/paths.js';
import { logger } from '../../lib/logger.js';
import { createWriteStream, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
    is_installed: resolveVersionBinary(v.version) !== null,
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
        is_installed: resolveVersionBinary(fsVer) !== null,
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
  } catch (e) {
    logger.warn({ err: e }, '[Version] Failed to fetch latest version from API');
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
  } catch (e) {
    logger.warn({ err: e }, '[Version] Failed to fetch all latest versions from API');
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

export async function installVersion(version: string, releaseType = 'stable'): Promise<void> {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new AppError('版本号格式无效', 400);
  }

  const db = getDb();
  const existing = repo.findVersionByVersion(db, version);
  if (existing) throw new AppError('该版本已安装', 409);

  installProgressMap.set(version, { progress: 0, status: '获取下载链接' });

  let downloadUrl: string;
  try {
    downloadUrl = await getDownloadUrl(version, releaseType);
  } catch (e) {
    installProgressMap.set(version, { progress: 0, status: '获取下载链接失败' });
    throw new AppError('获取下载链接失败', 500);
  }

  const factorioPath = resolveFactorioRoot();
  const versionsDir = path.resolve(factorioPath, 'versions');
  const versionDir = path.resolve(versionsDir, version);
  const archivePath = path.resolve(versionsDir, `factorio_headless_x64_${version}.tar.xz`);

  try {
    if (!existsSync(versionsDir)) mkdirSync(versionsDir, { recursive: true });

    installProgressMap.set(version, { progress: 10, status: '下载中' });
    await downloadFile(downloadUrl, archivePath, (progress) => {
      installProgressMap.set(version, { progress: 10 + Math.floor(progress * 60), status: '下载中' });
    });

    installProgressMap.set(version, { progress: 70, status: '解压中' });
    await extractTarXz(archivePath, versionsDir);

    installProgressMap.set(version, { progress: 90, status: '验证中' });
    const binPath = path.resolve(versionDir, 'bin', 'x64', 'factorio');
    if (!existsSync(binPath)) {
      const altDir = path.resolve(versionsDir, `factorio`);
      if (existsSync(path.resolve(altDir, 'bin', 'x64', 'factorio'))) {
        const fs = await import('node:fs/promises');
        try { if (existsSync(versionDir)) await fs.rm(versionDir, { recursive: true, force: true }); } catch {}
        await fs.rename(altDir, versionDir);
      }
    }

    if (!existsSync(binPath)) {
      throw new AppError(`版本 ${version} 安装后二进制文件不存在，解压目录结构可能不符合预期`, 500);
    }

    const now = Math.floor(Date.now() / 1000);
    const stat = existsSync(archivePath) ? await (await import('node:fs/promises')).stat(archivePath) : null;

    repo.createVersion(db, {
      version,
      release_type: releaseType,
      is_current: 0,
      backup_path: '',
      file_size: stat?.size || 0,
      sha256: '',
      installed_at: now,
    });

    installProgressMap.set(version, { progress: 100, status: '完成' });
  } catch (e) {
    try {
      if (existsSync(versionDir)) rmSync(versionDir, { recursive: true, force: true });
      if (existsSync(archivePath)) rmSync(archivePath, { force: true });
    } catch (e) { logger.warn({ err: e }, '[Version] Failed to cleanup after install error'); }

    installProgressMap.set(version, { progress: 0, status: '安装失败' });
    logger.error({ err: e, version }, '[Version] Install failed');
    throw new AppError(`版本安装失败: ${(e as Error).message}`, 500);
  } finally {
    try {
      if (existsSync(archivePath)) rmSync(archivePath, { force: true });
    } catch (e) { logger.warn({ err: e }, '[Version] Failed to remove archive after install'); }
  }
}

export function setDefaultVersion(version: string): void {
  const db = getDb();
  const ver = repo.findVersionByVersion(db, version);
  if (!ver) throw new AppError('版本不存在', 404);

  if (resolveVersionBinary(version) === null) {
    throw new AppError('版本二进制文件不存在，无法设为默认', 400);
  }

  repo.setAllVersionsNotCurrent(db);
  repo.updateVersionCurrent(db, ver.id, 1);
}

export function deleteVersionData(version: string): void {
  const db = getDb();
  const ver = repo.findVersionByVersion(db, version);
  if (!ver) throw new AppError('版本不存在', 404);

  if (ver.is_current) {
    const binExists = resolveVersionBinary(version) !== null;
    if (binExists) {
      throw new AppError('不能删除当前版本', 400);
    }
  }

  const versionDir = path.resolve(getFactorioPath(), 'versions', version);

  repo.deleteVersion(db, ver.id);

  if (existsSync(versionDir)) {
    try {
      rmSync(versionDir, { recursive: true, force: true });
      logger.info({ version, versionDir }, '[Version] 版本目录已删除');
    } catch (e) {
      logger.warn({ err: e, version, versionDir }, '[Version] 删除版本目录失败，请手动清理');
    }
  }
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

async function getDownloadUrl(version: string, releaseType: string): Promise<string> {
  return `https://factorio.com/get-download/${version}/headless/linux64`;
}

async function downloadFile(url: string, destPath: string, onProgress?: (ratio: number) => void): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new AppError(`下载失败: HTTP ${response.status}`, 500);

  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
  const fileStream = createWriteStream(destPath);

  if (!response.body) throw new AppError('下载响应体为空', 500);

  const reader = response.body.getReader();
  let downloaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fileStream.write(value);
    downloaded += value.length;
    if (contentLength > 0 && onProgress) {
      onProgress(downloaded / contentLength);
    }
  }

  fileStream.end();
  await new Promise<void>((resolve, reject) => {
    fileStream.on('finish', resolve);
    fileStream.on('error', reject);
  });
}

async function extractTarXz(archivePath: string, destDir: string): Promise<void> {
  const execFileAsync = promisify(execFile);
  await execFileAsync('tar', ['-xJf', archivePath, '-C', destDir], {
    timeout: 300000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

export function getInstallProgress(version: string): { progress: number; status: string } {
  const progress = installProgressMap.get(version);
  if (!progress) {
    return { progress: 0, status: '未开始' };
  }
  return progress;
}
