import { existsSync, readdirSync, statSync, writeFileSync, readFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { AppError } from '../../types/index.js';
import { resolveSavesDir, findFactorioBinary } from '../../lib/paths.js';

function getSavesDir(): string {
  return resolveSavesDir();
}

function getCurrentSaveFile(): string {
  const savesDir = getSavesDir();
  return path.join(savesDir, '.current_save');
}

function readCurrentSave(): string | null {
  const filePath = getCurrentSaveFile();
  try {
    const content = readFileSync(filePath, 'utf-8').trim();
    return content || null;
  } catch {
    return null;
  }
}

function writeCurrentSave(filename: string): void {
  const savesDir = getSavesDir();
  if (!existsSync(savesDir)) mkdirSync(savesDir, { recursive: true });
  writeFileSync(getCurrentSaveFile(), filename, 'utf-8');
}

function validateFilename(filename: string): void {
  if (!filename || typeof filename !== 'string') {
    throw new AppError('文件名不能为空', 400);
  }

  if (filename.length > 255) {
    throw new AppError('文件名过长', 400);
  }

  if (/[<>:"/\\|?*\x00-\x1f]/.test(filename)) {
    throw new AppError('文件名包含非法字符', 400);
  }

  if (filename.includes('..')) {
    throw new AppError('文件名不能包含路径遍历', 400);
  }
}

function validatePathWithinSavesDir(filePath: string): string {
  const savesDir = path.resolve(getSavesDir());

  try {
    const realFilePath = path.resolve(filePath);
    if (!realFilePath.startsWith(savesDir + path.sep) && realFilePath !== savesDir) {
      throw new AppError('非法的文件路径', 400);
    }
    return realFilePath;
  } catch (e) {
    if ((e as { statusCode?: number }).statusCode) throw e;
    throw new AppError('非法的文件路径', 400);
  }
}

export interface FileInfo {
  filename: string;
  display: string;
  size: number;
  size_mb: number;
  time: string;
  is_current: boolean;
}

export function listSaves(): FileInfo[] {
  const savesDir = getSavesDir();
  if (!existsSync(savesDir)) return [];

  const currentSave = readCurrentSave();

  const files = readdirSync(savesDir)
    .filter((f: string) => f.endsWith('.zip'))
    .filter((f: string) => !f.endsWith('.tmp.zip'))
    .map((f: string) => {
      const fp = path.join(savesDir, f);
      const stat = statSync(fp);
      return {
        filename: f,
        display: f.replace('.zip', ''),
        size: stat.size,
        size_mb: Math.round((stat.size / (1024 * 1024)) * 100) / 100,
        time: stat.mtime.toISOString(),
        is_current: currentSave === f,
      };
    })
    .sort((a: FileInfo, b: FileInfo) => b.time.localeCompare(a.time));

  return files;
}

export function uploadSave(fileBuffer: Buffer, filename: string): void {
  const savesDir = getSavesDir();
  if (!existsSync(savesDir)) mkdirSync(savesDir, { recursive: true });

  if (!filename.endsWith('.zip')) {
    throw new AppError('只允许上传.zip格式的存档文件', 400);
  }

  validateFilename(filename);

  writeFileSync(path.join(savesDir, filename), fileBuffer);
}

export function deleteSave(filename: string): void {
  const savesDir = getSavesDir();
  const filePath = path.join(savesDir, filename);

  validateFilename(filename);
  validatePathWithinSavesDir(filePath);

  if (!existsSync(filePath)) {
    throw new AppError('文件不存在', 404);
  }

  const currentSave = readCurrentSave();
  if (currentSave === filename) {
    throw new AppError('不能删除当前存档，请先切换至其他存档', 400);
  }

  unlinkSync(filePath);
}

export function getSaveDownloadPath(filename: string): string {
  validateFilename(filename);
  const savesDir = getSavesDir();
  const filePath = path.join(savesDir, filename);

  validatePathWithinSavesDir(filePath);

  if (!existsSync(filePath)) {
    throw new AppError('文件不存在', 404);
  }
  return filePath;
}

export function setCurrentSave(filename: string): string {
  validateFilename(filename);
  const savesDir = getSavesDir();
  const filePath = path.join(savesDir, filename);

  validatePathWithinSavesDir(filePath);

  if (!existsSync(filePath)) {
    throw new AppError('存档文件不存在', 404);
  }

  writeCurrentSave(filename);
  return filePath;
}

export interface CreateSaveResult {
  filename: string;
  size: string;
}

export async function createSave(params: { version: string; save_name?: string; seed?: string }): Promise<CreateSaveResult> {
  const saveName = params.save_name || `save-${Date.now()}`;
  const savesDir = getSavesDir();
  if (!existsSync(savesDir)) mkdirSync(savesDir, { recursive: true });

  const { binPath, rootDir: versionRootDir } = findFactorioBinary(params.version);

  const filename = `${saveName}.zip`;
  const filePath = path.join(savesDir, filename);

  if (existsSync(filePath)) {
    throw new AppError(`存档 ${filename} 已存在，请更换名称`, 409);
  }

  const args = ['--create', filePath];
  if (params.seed) {
    args.push('--map-gen-seed', params.seed);
  }

  await new Promise<void>((resolve, reject) => {
    execFile(binPath, args, {
      cwd: versionRootDir,
      env: { ...process.env },
      timeout: 180000,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const errorKind = error.killed ? '超时被终止' :
                          error.code === 'ENOENT' ? '二进制文件不可执行' :
                          error.code === 'EACCES' ? '无执行权限' :
                          `退出码 ${error.code || '未知'}`;
        const detail = (stderr || stdout || '').toString().trim().slice(0, 400);
        reject(new AppError(`地图生成失败 (${errorKind}): ${detail || error.message}`, 500));
        return;
      }
      resolve();
    });
  });

  if (!existsSync(filePath)) {
    throw new AppError(`地图生成失败: 存档文件 ${filename} 未生成`, 500);
  }

  const stat = statSync(filePath);
  const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);
  const size = `${sizeMb} MB`;

  return { filename, size };
}
