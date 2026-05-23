import { getDb } from '../../lib/database.js';
import { logger } from '../../lib/logger.js';
import * as repo from './config.repository.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { AppError } from '../../types/index.js';
import { resolveConfigDir } from '../../lib/paths.js';
import { eventBus } from '../../lib/event-bus.js';
import { MAX_BACKUP_COUNT } from '../../config/constants.js';

const CONFIG_FILE_TYPES: Record<string, { filename: string; isList: boolean }> = {
  'server-settings': { filename: 'server-settings.json', isList: false },
  'map-gen-settings': { filename: 'map-gen-settings.json', isList: false },
  'map-settings': { filename: 'map-settings.json', isList: false },
  'mod-list': { filename: 'mod-list.json', isList: true },
  'server-adminlist': { filename: 'server-adminlist.json', isList: true },
  'server-banlist': { filename: 'server-banlist.json', isList: true },
  'server-whitelist': { filename: 'server-whitelist.json', isList: true },
};

function getConfigDir(): string {
  return resolveConfigDir();
}

export function getConfigFiles() {
  const configDir = getConfigDir();
  const files: Array<{ type: string; filename: string; path: string; exists: boolean; is_list: boolean }> = [];

  for (const [type, info] of Object.entries(CONFIG_FILE_TYPES)) {
    const filePath = path.join(configDir, info.filename);
    const fileExists = existsSync(filePath);

    files.push({
      type,
      filename: info.filename,
      path: filePath,
      exists: fileExists,
      is_list: info.isList,
    });
  }

  return files;
}

export function getConfigFile(fileType: string) {
  const info = CONFIG_FILE_TYPES[fileType];
  if (!info) throw new AppError('未知配置文件类型', 404);

  const configDir = getConfigDir();
  const filePath = path.join(configDir, info.filename);

  if (!existsSync(filePath)) {
    return { content: null, raw: '', filename: info.filename };
  }

  const raw = readFileSync(filePath, 'utf-8');
  const content = JSON.parse(raw);

  return { content, raw, filename: info.filename };
}

function getBackupDir(fileType: string): string {
  const info = CONFIG_FILE_TYPES[fileType];
  if (!info) throw new AppError('未知配置文件类型', 404);
  return path.join(getConfigDir(), '.backups', info.filename);
}

function ensureBackupDir(backupDir: string): void {
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
}

export function listBackups(fileType: string) {
  const info = CONFIG_FILE_TYPES[fileType];
  if (!info) throw new AppError('未知配置文件类型', 404);

  const backupDir = getBackupDir(fileType);
  if (!existsSync(backupDir)) return [];

  const files = readdirSync(backupDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const filePath = path.join(backupDir, f);
      try {
        const stat = statSync(filePath);
        return {
          filename: f,
          timestamp: f.replace(/\.json$/, ''),
          created_at: stat.birthtime.toISOString(),
          size: stat.size,
        };
      } catch (e) { logger.warn({ err: e }, '[Config] Failed to stat backup file'); return null; }
    })
    .filter((b): b is NonNullable<typeof b> => b !== null)
    .sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1));

  return files;
}

export function restoreBackup(fileType: string, timestamp: string): void {
  const info = CONFIG_FILE_TYPES[fileType];
  if (!info) throw new AppError('未知配置文件类型', 404);

  const backupDir = getBackupDir(fileType);
  const backupFile = path.join(backupDir, timestamp + '.json');

  if (!existsSync(backupFile)) throw new AppError('备份文件不存在', 404);

  const configDir = getConfigDir();
  const targetPath = path.join(configDir, info.filename);

  copyFileSync(backupFile, targetPath);

  if (fileType === 'server-settings') {
    eventBus.emit('config:server-settings-changed', {});
  }
}

export function getBackupContent(fileType: string, timestamp: string): string {
  const info = CONFIG_FILE_TYPES[fileType];
  if (!info) throw new AppError('未知配置文件类型', 404);

  const backupDir = getBackupDir(fileType);
  const backupFile = path.join(backupDir, timestamp + '.json');

  if (!existsSync(backupFile)) throw new AppError('备份文件不存在', 404);

  return readFileSync(backupFile, 'utf-8');
}

export function cleanupBackups(fileType: string, keepCount: number = 10): number {
  const backups = listBackups(fileType);
  if (backups.length <= keepCount) return 0;

  const toDelete = backups.slice(keepCount);
  const backupDir = getBackupDir(fileType);
  let deleted = 0;

  for (const bk of toDelete) {
    try {
      unlinkSync(path.join(backupDir, bk.filename));
      deleted++;
    } catch (e) { logger.warn({ err: e }, '[Config] Failed to delete backup file'); }
  }

  return deleted;
}

function createBackup(fileType: string, filePath: string): void {
  if (!existsSync(filePath)) return;

  const currentContent = readFileSync(filePath, 'utf-8');
  const backupDir = getBackupDir(fileType);
  ensureBackupDir(backupDir);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, timestamp + '.json');

  writeFileSync(backupPath, currentContent);
  cleanupBackups(fileType, MAX_BACKUP_COUNT);
}

export function saveConfigFile(fileType: string, content: string): void {
  const info = CONFIG_FILE_TYPES[fileType];
  if (!info) throw new AppError('未知配置文件类型', 404);

  const configDir = getConfigDir();
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });

  const filePath = path.join(configDir, info.filename);

  try {
    JSON.parse(content);
  } catch {
    throw new AppError('无效的JSON格式', 400);
  }

  if (existsSync(filePath)) {
    const existingContent = readFileSync(filePath, 'utf-8');
    const normalizedExisting = JSON.stringify(JSON.parse(existingContent));
    const normalizedNew = JSON.stringify(JSON.parse(content));

    if (normalizedExisting !== normalizedNew) {
      createBackup(fileType, filePath);
    }
  }

  const formatted = JSON.stringify(JSON.parse(content), null, 2);
  writeFileSync(filePath, formatted + '\n');

  if (fileType === 'server-settings') {
    eventBus.emit('config:server-settings-changed', {});
  }
}

export function validateConfig(fileType: string, content: string): { valid: boolean; message?: string; errors?: string[] } {
  const info = CONFIG_FILE_TYPES[fileType];
  if (!info) return { valid: false, message: '未知配置文件类型' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { valid: false, message: '无效的JSON格式', errors: ['无法解析JSON'] };
  }

  const errors: string[] = [];

  if (fileType === 'server-settings') {
    const obj = parsed as Record<string, unknown>;
    if (!obj.name || typeof obj.name !== 'string') errors.push('name 是必填字段（字符串）');
    if (obj.max_players !== undefined) {
      if (typeof obj.max_players !== 'number' || obj.max_players < 0 || !Number.isInteger(obj.max_players)) {
        errors.push('max_players 必须是非负整数');
      }
    }
    if (obj.description !== undefined && typeof obj.description !== 'string') errors.push('description 必须是字符串');
    if (obj.tags !== undefined && !Array.isArray(obj.tags)) errors.push('tags 必须是数组');
    if (obj.visibility !== undefined) {
      const vis = obj.visibility as Record<string, unknown>;
      if (vis && typeof vis === 'object') {
        if (vis.public !== undefined && typeof vis.public !== 'boolean') errors.push('visibility.public 必须是布尔值');
        if (vis.lan !== undefined && typeof vis.lan !== 'boolean') errors.push('visibility.lan 必须是布尔值');
      }
    }
    if (obj.autosave_interval !== undefined && (typeof obj.autosave_interval !== 'number' || obj.autosave_interval < 1)) {
      errors.push('autosave_interval 必须是正整数');
    }
    if (obj.autosave_slots !== undefined && (typeof obj.autosave_slots !== 'number' || obj.autosave_slots < 1)) {
      errors.push('autosave_slots 必须是正整数');
    }
    if (obj.afk_autokick_interval !== undefined && (typeof obj.afk_autokick_interval !== 'number' || obj.afk_autokick_interval < 0)) {
      errors.push('afk_autokick_interval 必须是非负整数');
    }
  }

  if (fileType === 'map-gen-settings') {
    const obj = parsed as Record<string, unknown>;
    if (obj.width !== undefined && (typeof obj.width !== 'number' || obj.width <= 0)) errors.push('width 必须是正整数');
    if (obj.height !== undefined && (typeof obj.height !== 'number' || obj.height <= 0)) errors.push('height 必须是正整数');
    if (obj.seed !== undefined && typeof obj.seed !== 'string' && typeof obj.seed !== 'number') errors.push('seed 必须是字符串或数字');
    if (obj.water !== undefined && typeof obj.water !== 'string' && typeof obj.water !== 'number') errors.push('water 设置格式不正确');
    if (obj.starting_area !== undefined && typeof obj.starting_area !== 'string') errors.push('starting_area 必须是字符串');
    if (obj.peaceful_mode !== undefined && typeof obj.peaceful_mode !== 'boolean') errors.push('peaceful_mode 必须是布尔值');
    if (obj.terrain_segmentation !== undefined && typeof obj.terrain_segmentation !== 'string' && typeof obj.terrain_segmentation !== 'number') errors.push('terrain_segmentation 格式不正确');
  }

  if (fileType === 'map-settings') {
    const obj = parsed as Record<string, unknown>;
    if (obj.pollution !== undefined) {
      const pol = obj.pollution as Record<string, unknown>;
      if (pol && typeof pol === 'object') {
        if (pol.enabled !== undefined && typeof pol.enabled !== 'boolean') errors.push('pollution.enabled 必须是布尔值');
        if (pol.ageing !== undefined && typeof pol.ageing !== 'number') errors.push('pollution.ageing 必须是数字');
      }
    }
    if (obj.enemy_evolution !== undefined) {
      const evo = obj.enemy_evolution as Record<string, unknown>;
      if (evo && typeof evo === 'object') {
        if (evo.enabled !== undefined && typeof evo.enabled !== 'boolean') errors.push('enemy_evolution.enabled 必须是布尔值');
      }
    }
    if (obj.enemy_expansion !== undefined) {
      const exp = obj.enemy_expansion as Record<string, unknown>;
      if (exp && typeof exp === 'object') {
        if (exp.enabled !== undefined && typeof exp.enabled !== 'boolean') errors.push('enemy_expansion.enabled 必须是布尔值');
      }
    }
  }

  if (info.isList) {
    if (!Array.isArray(parsed)) {
      errors.push('内容必须是数组格式');
    } else if (fileType === 'mod-list') {
      for (let i = 0; i < (parsed as unknown[]).length; i++) {
        const item = (parsed as Record<string, unknown>[])[i];
        if (!item || typeof item !== 'object') errors.push(`mod-list[${i}] 必须是对象`);
        else if (!item.name || typeof item.name !== 'string') errors.push(`mod-list[${i}].name 是必填字段`);
      }
    } else if (fileType === 'server-adminlist') {
      for (let i = 0; i < (parsed as unknown[]).length; i++) {
        if (typeof (parsed as unknown[])[i] !== 'string') errors.push(`adminlist[${i}] 必须是字符串`);
      }
    } else if (fileType === 'server-banlist') {
      for (let i = 0; i < (parsed as unknown[]).length; i++) {
        const item = (parsed as Record<string, unknown>[])[i];
        if (!item || typeof item !== 'object') errors.push(`banlist[${i}] 必须是对象`);
        else if (!item.username || typeof item.username !== 'string') errors.push(`banlist[${i}].username 是必填字段`);
      }
    } else if (fileType === 'server-whitelist') {
      for (let i = 0; i < (parsed as unknown[]).length; i++) {
        if (typeof (parsed as unknown[])[i] !== 'string') errors.push(`whitelist[${i}] 必须是字符串`);
      }
    }
  }

  return { valid: errors.length === 0, message: errors.length > 0 ? '验证失败' : '验证通过', errors };
}

export function listTemplates() {
  return repo.listTemplates(getDb());
}

export function getTemplate(id: number) {
  const tpl = repo.findTemplateById(getDb(), id);
  if (!tpl) throw new AppError('模板不存在', 404);
  return tpl;
}

export function createTemplate(data: { name: string; description?: string; config?: string; config_type?: string; created_by?: string }) {
  return repo.createTemplate(getDb(), {
    name: data.name,
    description: data.description || '',
    config_json: data.config || '{}',
    config_type: data.config_type || null,
    created_by: data.created_by || '',
  });
}

export function deleteTemplate(id: number): void {
  const ok = repo.deleteTemplate(getDb(), id);
  if (!ok) throw new AppError('模板不存在', 404);
}

export function applyTemplate(templateId: number): void {
  const tpl = repo.findTemplateById(getDb(), templateId);
  if (!tpl) throw new AppError('模板不存在', 404);

  try {
    const config = JSON.parse(tpl.config_json);
    const configDir = getConfigDir();
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });

    if (tpl.config_type && CONFIG_FILE_TYPES[tpl.config_type]) {
      const info = CONFIG_FILE_TYPES[tpl.config_type];
      const filePath = path.join(configDir, info.filename);

      if (existsSync(filePath)) {
        createBackup(tpl.config_type, filePath);
      }

      writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n');
      return;
    }

    for (const [key, value] of Object.entries(config)) {
      const info = CONFIG_FILE_TYPES[key];
      if (!info) continue;
      const filePath = path.join(configDir, info.filename);

      if (existsSync(filePath)) {
        createBackup(key, filePath);
      }

      writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
    }
  } catch (_e) {
    throw new AppError('应用模板失败: 配置解析错误', 500);
  }
}
