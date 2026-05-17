import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AppError } from '../../types/index.js';
import { resolveLogPath, resolveLogsDir } from '../../lib/paths.js';

function getLogsDir(): string {
  return resolveLogsDir();
}

function getCurrentLogPath(): string {
  return resolveLogPath();
}

export interface LogEntry {
  time: string;
  type: string;
  level: string;
  message: string;
  raw: string;
}

export interface LogStats {
  total_count: number;
  count_by_level: Record<string, number>;
  count_by_area: Record<string, number>;
}

export function tailLog(lines = 100): { logs: LogEntry[]; stats: LogStats } {
  const logPath = getCurrentLogPath();
  if (!existsSync(logPath)) return { logs: [], stats: { total_count: 0, count_by_level: {}, count_by_area: {} } };

  const content = readFileSync(logPath, 'utf-8');
  const allLines = content.split('\n').filter((l) => l.trim());
  const tailLines = allLines.slice(-lines);

  let lastTimestamp = '';
  for (const line of allLines) {
    const m = line.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
    if (m) lastTimestamp = m[1];
  }

  const logs: LogEntry[] = [];
  let tailTimestamp = lastTimestamp;

  for (const line of tailLines) {
    const entry = parseLogLine(line);
    if (!entry) continue;
    if (entry.time) {
      tailTimestamp = entry.time;
    } else if (tailTimestamp) {
      entry.time = tailTimestamp;
    }
    logs.push(entry);
  }
  return { logs, stats: buildStats(logs) };
}

export function getLogHistory(params: {
  page?: number;
  page_size?: number;
  level?: string;
  search?: string;
  start_date?: string;
  end_date?: string;
  type?: string;
}): { logs: LogEntry[]; total: number; page: number; page_size: number } {
  const logPath = getCurrentLogPath();
  const page = params.page || 1;
  const pageSize = params.page_size || 50;

  if (!existsSync(logPath)) return { logs: [], total: 0, page, page_size: pageSize };

  const content = readFileSync(logPath, 'utf-8');
  const allLines = content.split('\n').filter((l) => l.trim());
  let logs: LogEntry[] = [];
  let lastTimestamp = '';

  for (const line of allLines) {
    const entry = parseLogLine(line);
    if (!entry) continue;
    if (entry.time) {
      lastTimestamp = entry.time;
    } else if (lastTimestamp) {
      entry.time = lastTimestamp;
    }
    logs.push(entry);
  }

  if (params.type) {
    logs = logs.filter((l) => l.type === params.type);
  }

  if (params.level) {
    const levelOrder: Record<string, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
    const minLevel = levelOrder[params.level] || 0;
    logs = logs.filter((l) => (levelOrder[l.level] || 0) >= minLevel);
  }

  if (params.search) {
    const q = params.search.toLowerCase();
    logs = logs.filter((l) => l.message.toLowerCase().includes(q) || l.raw.toLowerCase().includes(q));
  }

  if (params.start_date) {
    const start = new Date(params.start_date).getTime();
    if (!isNaN(start)) {
      logs = logs.filter((l) => new Date(l.time).getTime() >= start);
    }
  }

  if (params.end_date) {
    const end = new Date(params.end_date).getTime();
    if (!isNaN(end)) {
      logs = logs.filter((l) => new Date(l.time).getTime() <= end);
    }
  }

  const total = logs.length;
  const start = (page - 1) * pageSize;
  const pagedLogs = logs.slice(start, start + pageSize);

  return { logs: pagedLogs, total, page, page_size: pageSize };
}

export function listLogFiles(): Array<{ filename: string; size: number; time: string; is_current: boolean }> {
  const logsDir = getLogsDir();
  const currentLogPath = getCurrentLogPath();
  const results: Array<{ filename: string; size: number; time: string; is_current: boolean }> = [];

  if (!existsSync(logsDir)) return results;

  for (const entry of readdirSync(logsDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.startsWith('factorio-') && entry.name.endsWith('.log')) {
      const fp = path.join(logsDir, entry.name);
      const stat = statSync(fp);
      results.push({
        filename: entry.name,
        size: stat.size,
        time: stat.mtime.toISOString(),
        is_current: fp === currentLogPath,
      });
    }
  }

  results.sort((a, b) => b.time.localeCompare(a.time));
  return results;
}

export function getLogDownloadPath(filename: string): string {
  if (!/^factorio-[\w\-.]+\.log$/.test(filename)) {
    throw new AppError('非法的文件名', 400);
  }

  const logsDir = getLogsDir();
  const filePath = path.join(logsDir, filename);
  if (!existsSync(filePath)) {
    throw new AppError('文件不存在', 404);
  }

  return filePath;
}

export function deleteLogFile(filename: string): void {
  if (!/^factorio-[\w\-.]+\.log$/.test(filename)) {
    throw new AppError('非法的文件名', 400);
  }

  const logsDir = getLogsDir();
  const filePath = path.join(logsDir, filename);
  const currentLogPath = getCurrentLogPath();

  if (filePath === currentLogPath) {
    throw new AppError('不能删除当前日志文件', 400);
  }

  if (!existsSync(filePath)) {
    throw new AppError('文件不存在', 404);
  }

  unlinkSync(filePath);
}

export function clearLogs(params: {
  type: 'time' | 'count';
  value: number;
  categories: string[];
}): { deleted: number } {
  const logPath = getCurrentLogPath();
  if (!existsSync(logPath)) return { deleted: 0 };

  const content = readFileSync(logPath, 'utf-8');
  const allLines = content.split('\n');
  let lines = allLines.map((line, index) => ({ line, index }));

  if (params.categories && params.categories.length > 0) {
    lines = lines.filter(({ line }) => {
      const parsed = parseLogLine(line);
      return !parsed || !params.categories.includes(parsed.type);
    });
  }

  if (params.type === 'time') {
    const cutoff = Date.now() - params.value * 86400000;
    lines = lines.filter(({ line }) => {
      const timeMatch = line.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
      if (!timeMatch) return true;
      return new Date(timeMatch[1]).getTime() >= cutoff;
    });
  } else if (params.type === 'count') {
    if (lines.length > params.value) {
      lines = lines.slice(-params.value);
    }
  }

  const deleted = allLines.length - lines.length;
  writeFileSync(logPath, lines.map((l) => l.line).join('\n'), 'utf-8');
  return { deleted };
}

function parseLogLine(line: string): LogEntry | null {
  if (!line.trim()) return null;

  const timestampMatch = line.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
  const time = timestampMatch ? timestampMatch[1] : '';

  let type = 'system';
  let level = 'INFO';
  let message = line;

  const factorioMatch = line.match(/^\s*[\d.]+\s+(Verbose|Info|Warning|Error)\s+(.+)$/);
  if (factorioMatch) {
    const lvl = factorioMatch[1];
    message = factorioMatch[2].trim();
    if (lvl === 'Error') {
      type = 'error';
      level = 'ERROR';
    } else if (lvl === 'Warning') {
      type = 'error';
      level = 'WARN';
    } else if (lvl === 'Verbose') {
      level = 'DEBUG';
    }
  } else if (line.includes('[CHAT]')) {
    type = 'chat';
    message = line.replace(/.*?\[CHAT\]\s*/, '');
  } else if (line.includes('[JOIN]')) {
    type = 'login';
    message = line.replace(/^.*?\[JOIN\]\s*/, '');
  } else if (line.includes('[LEAVE]')) {
    type = 'login';
    message = line.replace(/^.*?\[LEAVE\]\s*/, '');
  } else if (line.includes('joined the game')) {
    type = 'login';
  } else if (line.includes('left the game')) {
    type = 'login';
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

function buildStats(logs: LogEntry[]): LogStats {
  const count_by_level: Record<string, number> = {};
  const count_by_area: Record<string, number> = {};

  for (const log of logs) {
    count_by_level[log.level] = (count_by_level[log.level] || 0) + 1;
    count_by_area[log.type] = (count_by_area[log.type] || 0) + 1;
  }

  return { total_count: logs.length, count_by_level, count_by_area };
}
