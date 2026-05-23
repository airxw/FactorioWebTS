import { getDb } from '../../lib/database.js';
import type Database from 'better-sqlite3';
import * as repo from './mod.repository.js';
import { resolveConfigDir, resolveModsDir, resolveDataDir } from '../../lib/paths.js';
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { AppError } from '../../types/index.js';
import { MAX_ZIP_FILE_SIZE, MAX_CONCURRENT_REQUESTS } from '../../config/constants.js';

function getConfigDir(): string {
  return resolveConfigDir();
}

function syncModListJson(): void {
  const modsDir = resolveModsDir();
  if (!existsSync(modsDir)) mkdirSync(modsDir, { recursive: true });

  const mods = repo.listInstalledMods(getDb())
    .filter(m => m.is_enabled)
    .map(m => ({ name: m.name, enabled: true }));

  const filePath = path.join(modsDir, 'mod-list.json');
  writeFileSync(filePath, JSON.stringify({ mods }, null, 2) + '\n');
}

export function listInstalledMods() {
  const mods = repo.listInstalledMods(getDb());
  return mods.map((m) => ({
    id: m.id,
    name: m.name,
    display_name: m.display_name || m.name,
    version: m.version,
    author: m.author,
    description: m.description,
    category: m.category,
    enabled: Boolean(m.is_enabled),
    is_installed: Boolean(m.is_installed),
    has_update: Boolean(m.has_update),
    game_version: m.game_version,
    download_url: m.download_url,
    dependencies: parseDeps(m.dependencies_json),
  }));
}

function parseDeps(json: string): unknown[] {
  try { return JSON.parse(json); } catch { return []; }
}

export function toggleMod(modId: number, enabled: number): void {
  const mod = repo.findModById(getDb(), modId);
  if (!mod) throw new AppError('模组不存在', 404);
  repo.updateModEnabled(getDb(), modId, enabled);
  syncModListJson();
}

export function uninstallMod(modId: number): void {
  const mod = repo.findModById(getDb(), modId);
  if (!mod) throw new AppError('模组不存在', 404);

  if (mod.file_path && existsSync(mod.file_path)) {
    try { unlinkSync(mod.file_path); } catch {}
  }

  repo.deleteMod(getDb(), modId);
  syncModListJson();
}

export function getModDependencies(modId: number) {
  const mod = repo.findModById(getDb(), modId);
  if (!mod) throw new AppError('模组不存在', 404);

  const deps = parseDeps(mod.dependencies_json);
  const allMods = repo.listInstalledMods(getDb());
  const installedNames = new Set(allMods.map((m) => m.name));

  const required: Array<{ name: string; installed: boolean }> = [];
  const optional: Array<{ name: string; installed: boolean }> = [];

  for (const dep of deps as Array<{ name?: string; optional?: boolean }>) {
    const name = dep.name || '';
    const isOptional = dep.optional === true;
    const entry = { name, installed: installedNames.has(name) };
    if (isOptional) optional.push(entry);
    else required.push(entry);
  }

  return { required, optional };
}

export interface ConflictResult {
  type: string;
  mod_name: string;
  message: string;
}

export function checkConflicts(modIds: number[]): ConflictResult[] {
  const db = getDb();
  const conflicts: ConflictResult[] = [];
  const allMods = repo.listInstalledMods(db);

  const selectedMods = modIds
    .map((id) => repo.findModById(db, id))
    .filter(Boolean) as NonNullable<ReturnType<typeof repo.findModById>>[];

  if (selectedMods.length === 0) return [];

  const installedNames = new Set(allMods.map((m) => m.name));

  for (const mod of selectedMods) {
    const deps = parseDeps(mod.dependencies_json) as Array<{
      name?: string;
      optional?: boolean;
      version?: string;
      op?: string;
    }>;

    for (const dep of deps) {
      const name = dep.name || '';

      if (!name || dep.optional === true) continue;

      const isMissing = !installedNames.has(name);
      if (isMissing) {
        conflicts.push({
          type: 'missing_dependency',
          mod_name: mod.name,
          message: `缺少必需依赖: ${name}${dep.version ? ' (' + (dep.op || '>=') + dep.version + ')' : ''}`,
        });
      }
    }
  }

  return conflicts;
}



async function checkModUpdate(mod: { id: number; name: string; version: string }): Promise<{ id: number; hasUpdate: boolean } | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(`https://mods.factorio.com/api/mods/${encodeURIComponent(mod.name)}`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    clearTimeout(timeoutId);

    if (!res.ok) return null;

    const data = (await res.json()) as { latest_release?: { version?: string } };
    const latestVersion = data?.latest_release?.version;

    if (latestVersion && latestVersion !== mod.version) {
      return { id: mod.id, hasUpdate: true };
    }

    return { id: mod.id, hasUpdate: false };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn(`[checkForUpdates] Timeout checking ${mod.name}`);
    } else {
      console.warn(`[checkForUpdates] Failed to check ${mod.name}:`, error);
    }
    return null;
  }
}

async function processInBatches<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  batchSize: number
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(processor));
    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value !== null) {
        results.push(result.value);
      }
    }
  }

  return results;
}

export async function checkForUpdates() {
  const db = getDb();
  repo.resetAllHasUpdate(db);

  const mods = repo.listInstalledMods(db);

  if (mods.length === 0) {
    return { checked: 0, updates: 0 };
  }

  const results = await processInBatches(
    mods,
    (mod) => checkModUpdate(mod),
    MAX_CONCURRENT_REQUESTS
  );

  let updatesAvailable = 0;
  for (const result of results) {
    if (result && result.hasUpdate) {
      repo.updateModHasUpdate(db, result.id, 1);
      updatesAvailable++;
    }
  }

  return { checked: mods.length, updates: updatesAvailable };
}

interface SyncResult {
  added: number;
  synced: number;
  removed: number;
}

interface ModInfoJson {
  name: string;
  title?: string;
  version: string;
  author?: string;
  description?: string;
  factorio_version?: string;
  dependencies?: string[];
}



const MAX_INFO_JSON_SIZE = 1024 * 1024;

function readInfoJsonFromZip(zipPath: string): ModInfoJson | null {
  try {
    const stats = readFileSync(zipPath);
    if (stats.length < 22) {
      console.warn(`[readInfoJsonFromZip] File too small: ${zipPath} (${stats.length} bytes)`);
      return null;
    }

    if (stats.length > MAX_ZIP_FILE_SIZE) {
      console.warn(`[readInfoJsonFromZip] File too large: ${zipPath} (${(stats.length / 1024 / 1024).toFixed(2)}MB > ${(MAX_ZIP_FILE_SIZE / 1024 / 1024)}MB limit)`);
      return null;
    }

    const buf = stats;
    const eocdSig = 0x06054b50;
    let eocdOffset = -1;

    const maxSearchLength = Math.min(65535, buf.length - 22);
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - maxSearchLength); i--) {
      if (buf.readUInt32LE(i) === eocdSig) {
        eocdOffset = i;
        break;
      }
    }

    if (eocdOffset < 0) {
      console.warn(`[readInfoJsonFromZip] EOCD not found: ${zipPath}`);
      return null;
    }

    const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);
    const commentLen = buf.readUInt16LE(eocdOffset + 20);

    if (centralDirOffset >= buf.length || centralDirOffset < 0) {
      console.error(`[readInfoJsonFromZip] Invalid central directory offset: ${centralDirOffset}`);
      return null;
    }

    if (eocdOffset !== buf.length - 22 - commentLen) {
      console.warn(`[readInfoJsonFromZip] EOCD mismatch in ${zipPath}, possible corrupted zip`);
    }

    let offset = centralDirOffset;
    const cdSig = 0x02014b50;
    let infoJsonLocalOffset = -1;
    let infoJsonCompressedSize = 0;
    let infoJsonCompression = 0;

    let entryCount = 0;
    const maxEntries = 1000;

    while (offset < eocdOffset && entryCount < maxEntries) {
      if (offset + 46 > buf.length) {
        console.error(`[readInfoJsonFromZip] Central directory entry truncated at offset ${offset}`);
        break;
      }

      if (buf.readUInt32LE(offset) !== cdSig) {
        console.warn(`[readInfoJsonFromZip] Invalid central directory signature at offset ${offset}`);
        break;
      }

      const compression = buf.readUInt16LE(offset + 10);
      const compressedSize = buf.readUInt32LE(offset + 20);
      const filenameLen = buf.readUInt16LE(offset + 28);
      const extraLen = buf.readUInt16LE(offset + 30);
      const commentLen2 = buf.readUInt16LE(offset + 32);
      const localOffset = buf.readUInt32LE(offset + 42);

      if (filenameLen > 1024 || extraLen > 65536 || commentLen2 > 65536) {
        console.error(`[readInfoJsonFromZip] Suspicious entry at offset ${offset}: filenameLen=${filenameLen}, extraLen=${extraLen}`);
        break;
      }

      if (offset + 46 + filenameLen > buf.length) {
        console.error(`[readInfoJsonFromZip] Filename extends beyond buffer at offset ${offset}`);
        break;
      }

      const filename = buf.toString('utf8', offset + 46, offset + 46 + filenameLen);

      if (filename === 'info.json') {
        if (compressedSize > MAX_INFO_JSON_SIZE) {
          console.error(`[readInfoJsonFromZip] info.json too large: ${compressedSize} bytes`);
          return null;
        }

        infoJsonLocalOffset = localOffset;
        infoJsonCompressedSize = compressedSize;
        infoJsonCompression = compression;
        break;
      }

      offset += 46 + filenameLen + extraLen + commentLen2;
      entryCount++;
    }

    if (entryCount >= maxEntries) {
      console.warn(`[readInfoJsonFromZip] Too many entries (>${maxEntries}), stopping search`);
    }

    if (infoJsonLocalOffset < 0) {
      return null;
    }

    if (infoJsonLocalOffset + 30 > buf.length) {
      console.error(`[readInfoJsonFromZip] Local file header beyond buffer at offset ${infoJsonLocalOffset}`);
      return null;
    }

    const lfhSig = 0x04034b50;
    if (buf.readUInt32LE(infoJsonLocalOffset) !== lfhSig) {
      console.error(`[readInfoJsonFromZip] Invalid local file header signature at offset ${infoJsonLocalOffset}`);
      return null;
    }

    const localFilenameLen = buf.readUInt16LE(infoJsonLocalOffset + 26);
    const localExtraLen = buf.readUInt16LE(infoJsonLocalOffset + 28);
    const dataOffset = infoJsonLocalOffset + 30 + localFilenameLen + localExtraLen;

    if (dataOffset + infoJsonCompressedSize > buf.length) {
      console.error(`[readInfoJsonFromZip] Compressed data extends beyond buffer: offset=${dataOffset}, size=${infoJsonCompressedSize}, bufLen=${buf.length}`);
      return null;
    }

    const compressedData = buf.subarray(dataOffset, dataOffset + infoJsonCompressedSize);

    let jsonBytes: Buffer;
    if (infoJsonCompression === 0) {
      jsonBytes = compressedData;
    } else if (infoJsonCompression === 8) {
      try {
        jsonBytes = zlib.inflateRawSync(compressedData);
      } catch (error) {
        console.error(`[readInfoJsonFromZip] Failed to decompress info.json:`, error);
        return null;
      }
    } else {
      console.warn(`[readInfoJsonFromZip] Unsupported compression method: ${infoJsonCompression}`);
      return null;
    }

    if (jsonBytes.length > MAX_INFO_JSON_SIZE) {
      console.error(`[readInfoJsonFromZip] Decompressed info.json too large: ${jsonBytes.length} bytes`);
      return null;
    }

    try {
      const jsonStr = jsonBytes.toString('utf8');
      const obj = JSON.parse(jsonStr);

      if (typeof obj?.name !== 'string' || !obj.name.trim()) {
        console.warn(`[readInfoJsonFromZip] Invalid or missing name in info.json`);
        return null;
      }

      if (typeof obj?.version !== 'string' || !obj.version.trim()) {
        console.warn(`[readInfoJsonFromZip] Invalid or missing version in info.json`);
        return null;
      }

      return obj as ModInfoJson;
    } catch (error) {
      console.error(`[readInfoJsonFromZip] Failed to parse info.json:`, error);
      return null;
    }
  } catch (error) {
    console.error(`[readInfoJsonFromZip] Unexpected error processing ${zipPath}:`, error);
    return null;
  }
}

const BUILTIN_MOD_NAMES = ['base', 'space-age', 'elevated-rails', 'quality'];

function readInfoJsonFromFile(filePath: string): ModInfoJson | null {
  try {
    if (!existsSync(filePath)) return null;

    const content = readFileSync(filePath, 'utf8');
    if (content.length > MAX_INFO_JSON_SIZE) {
      console.error(`[readInfoJsonFromFile] File too large: ${filePath}`);
      return null;
    }

    const obj = JSON.parse(content);

    if (typeof obj?.name !== 'string' || !obj.name.trim()) {
      console.warn(`[readInfoJsonFromFile] Invalid or missing name in: ${filePath}`);
      return null;
    }

    if (typeof obj?.version !== 'string' || !obj.version.trim()) {
      console.warn(`[readInfoJsonFromFile] Invalid or missing version in: ${filePath}`);
      return null;
    }

    return obj as ModInfoJson;
  } catch (error) {
    console.error(`[readInfoJsonFromFile] Error reading ${filePath}:`, error);
    return null;
  }
}

function syncBuiltinMods(db: Database.Database, result: SyncResult): void {
  const dataDir = resolveDataDir();

  if (!existsSync(dataDir)) {
    console.log(`[syncBuiltinMods] Data directory does not exist: ${dataDir}`);
    return;
  }

  try {
    const entries = readdirSync(dataDir);

    for (const entry of entries) {
      if (!BUILTIN_MOD_NAMES.includes(entry)) continue;

      const modDir = path.join(dataDir, entry);
      const infoPath = path.join(modDir, 'info.json');

      try {
        const stat = statSync(modDir);
        if (!stat.isDirectory()) continue;

        const info = readInfoJsonFromFile(infoPath);
        if (!info) {
          console.warn(`[syncBuiltinMods] Failed to read info.json for built-in mod: ${entry}`);
          continue;
        }

        const existing = repo.findModByName(db, info.name);
        const isNew = !existing || existing.version !== info.version;

        repo.createMod(db, {
          name: info.name,
          display_name: info.title || info.name,
          version: info.version,
          author: info.author || '',
          description: '',
          category: 'builtin',
          is_enabled: existing ? existing.is_enabled : 1,
          is_installed: 1,
          has_update: 0,
          game_version: info.factorio_version || '',
          download_url: '',
          file_path: modDir,
          dependencies_json: JSON.stringify(info.dependencies || []),
        });

        if (isNew) {
          result.added++;
          console.log(`[syncBuiltinMods] Added built-in mod: ${info.name} v${info.version}`);
        } else {
          result.synced++;
          console.log(`[syncBuiltinMods] Updated built-in mod: ${info.name} v${info.version}`);
        }
      } catch (error) {
        console.error(`[syncBuiltinMods] Error processing built-in mod ${entry}:`, error);
      }
    }
  } catch (error) {
    console.error('[syncBuiltinMods] Error reading data directory:', error);
  }
}

const FACTORIO_PORTAL_API = 'https://mods.factorio.com/api';

export interface PortalModResult {
  name: string;
  title: string;
  owner: string;
  description: string;
  downloads: number;
  thumbnail: string;
  updated_at: string;
  latest_release?: {
    version: string;
    download_url: string;
    filename: string;
    file_size: number;
    released_at: string;
    game_version: string;
    sha1: string;
  };
}

export interface PortalSearchResponse {
  results: PortalModResult[];
  page: number;
  page_count: number;
  count: number;
}

export async function searchModsFromPortal(
  query: string,
  page: number = 1,
  pageSize: number = 10,
  sort: 'top' | 'new' | 'updated' = 'top',
  order: 'asc' | 'desc' = 'desc'
): Promise<PortalSearchResponse> {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    page_size: String(pageSize),
    sort,
    order,
  });

  const url = `${FACTORIO_PORTAL_API}/mods?${params.toString()}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Portal API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as {
      results: Array<{
        name: string;
        title: string;
        owner: string;
        summary: string;
        downloads_count: number;
        thumbnail: string;
        updated_at: string;
        releases: Array<{
          version: string;
          download_url: string;
          filename: string;
          file_size: number;
          released_at: string;
          game_version: string;
          sha1: string;
        }>;
      }>;
      pagination: { page: number; page_count: number; count: number };
    };

    const results: PortalModResult[] = data.results.map((mod) => {
      const latestRelease = mod.releases?.[0];

      return {
        name: mod.name,
        title: mod.title,
        owner: mod.owner,
        description: mod.summary || '',
        downloads: mod.downloads_count || 0,
        thumbnail: mod.thumbnail || '',
        updated_at: mod.updated_at,
        latest_release: latestRelease
          ? {
              version: latestRelease.version,
              download_url: latestRelease.download_url,
              filename: latestRelease.filename,
              file_size: latestRelease.file_size,
              released_at: latestRelease.released_at,
              game_version: latestRelease.game_version,
              sha1: latestRelease.sha1,
            }
          : undefined,
      };
    });

    return {
      results,
      page: data.pagination?.page || page,
      page_count: data.pagination?.page_count || 1,
      count: data.pagination?.count || results.length,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('搜索超时，请稍后重试');
    }
    console.error('[searchModsFromPortal] Error:', error);
    throw new Error(`搜索失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

export async function getModDetailsFromPortal(modName: string): Promise<PortalModResult | null> {
  const url = `${FACTORIO_PORTAL_API}/mods/${encodeURIComponent(modName)}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    clearTimeout(timeoutId);

    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`API error: ${res.status}`);
    }

    const data = (await res.json()) as {
      name: string;
      title: string;
      owner: string;
      description: string;
      homepage: string;
      downloads_count: number;
      thumbnail: string;
      updated_at: string;
      releases: Array<{
        version: string;
        download_url: string;
        filename: string;
        file_size: number;
        released_at: string;
        game_version: string;
        sha1: string;
        info_json: ModInfoJson;
      }>;
    };

    const latestRelease = data.releases?.[0];

    return {
      name: data.name,
      title: data.title,
      owner: data.owner,
      description: data.description || '',
      downloads: data.downloads_count || 0,
      thumbnail: data.thumbnail || '',
      updated_at: data.updated_at,
      latest_release: latestRelease
        ? {
            version: latestRelease.version,
            download_url: latestRelease.download_url,
            filename: latestRelease.filename,
            file_size: latestRelease.file_size,
            released_at: latestRelease.released_at,
            game_version: latestRelease.game_version,
            sha1: latestRelease.sha1,
          }
        : undefined,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('获取详情超时');
    }
    console.error(`[getModDetailsFromPortal] Error for ${modName}:`, error);
    throw error;
  }
}

export async function installModFromPortal(
  modName: string,
  version?: string
): Promise<{ success: boolean; message: string; mod_id?: number }> {
  const modsPath = resolveModsDir();

  if (!existsSync(modsPath)) {
    mkdirSync(modsPath, { recursive: true });
  }

  let modInfo: PortalModResult;

  try {
    const details = await getModDetailsFromPortal(modName);
    if (!details) {
      throw new Error(`模组 "${modName}" 在Factorio Portal上不存在`);
    }

    if (!details.latest_release) {
      throw new Error(`模组 "${modName}" 没有可用的发布版本`);
    }

    modInfo = details;
  } catch (error) {
    throw new Error(`获取模组信息失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }

  const release = modInfo.latest_release!;
  const targetVersion = version || release.version;
  const targetRelease = version
    ? modInfo.name === modName && release.version === version
      ? release
      : null
    : release;

  if (!targetRelease) {
    const allVersions = (await getModDetailsFromPortal(modName))?.latest_release
      ? [release.version]
      : [];
    throw new Error(
      `请求的版本 "${version}" 不可用。可用版本: ${allVersions.join(', ') || '无'}`
    );
  }

  const downloadUrl = `https://mods.factorio.com${targetRelease.download_url}`;
  const fileName = targetRelease.filename || `${modName}_${targetVersion}.zip`;
  const filePath = path.join(modsPath, fileName);

  try {
    console.log(`[installModFromPortal] Downloading ${modName} v${targetVersion}...`);

    const controller = new AbortController();
    const downloadTimeout = setTimeout(() => controller.abort(), 300000);

    const res = await fetch(downloadUrl, {
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(downloadTimeout);

    if (!res.ok) {
      throw new Error(`下载失败: HTTP ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > MAX_ZIP_FILE_SIZE) {
      throw new Error(`文件过大: ${(buffer.length / 1024 / 1024).toFixed(2)}MB > ${(MAX_ZIP_FILE_SIZE / 1024 / 1024)}MB`);
    }

    writeFileSync(filePath, buffer);
    console.log(`[installModFromPortal] Downloaded to ${filePath}`);

    const info = readInfoJsonFromZip(filePath);
    if (!info) {
      unlinkSync(filePath);
      throw new Error('下载的文件不是有效的Factorio模组（缺少info.json）');
    }

    const db = getDb();

    const existing = repo.findModByName(db, info.name);
    if (existing) {
      repo.deleteMod(db, existing.id);
      console.log(`[installModFromPortal] Replaced existing mod: ${info.name}`);
    }

    const modId = repo.createMod(db, {
      name: info.name,
      display_name: info.title || info.name,
      version: info.version,
      author: info.author || modInfo.owner,
      description: info.description || modInfo.description,
      category: '',
      is_enabled: 1,
      is_installed: 1,
      has_update: 0,
      game_version: info.factorio_version || release.game_version,
      download_url: downloadUrl,
      file_path: filePath,
      dependencies_json: JSON.stringify(info.dependencies || []),
    });

    syncModListJson();

    console.log(`[installModFromPortal] Successfully installed: ${info.name} v${info.version} (ID: ${modId})`);

    return {
      success: true,
      message: `成功安装模组 "${info.title || info.name}" 版本 ${info.version}`,
      mod_id: modId,
    };
  } catch (error) {
    if (existsSync(filePath)) {
      try { unlinkSync(filePath); } catch {}
    }

    console.error(`[installModFromPortal] Installation failed for ${modName}:`, error);

    throw new Error(
      `安装失败: ${error instanceof Error ? error.message : '未知错误'}`
    );
  }
}

export function syncFromFilesystem(): SyncResult {
  const modsPath = resolveModsDir();
  const result: SyncResult = { added: 0, synced: 0, removed: 0 };

  if (!existsSync(modsPath)) {
    console.warn(`[syncFromFilesystem] Mods directory does not exist: ${modsPath}`);
    return result;
  }

  const db = getDb();

  try {
    syncBuiltinMods(db, result);

    const entries = readdirSync(modsPath);
    const existingFiles = new Set<string>();

    for (const entry of entries) {
      if (!entry.endsWith('.zip')) continue;

      const zipPath = path.join(modsPath, entry);
      existingFiles.add(zipPath);

      try {
        const info = readInfoJsonFromZip(zipPath);
        if (!info) {
          console.warn(`[syncFromFilesystem] Failed to parse info.json from: ${entry}`);
          continue;
        }

        const existing = repo.findModByName(db, info.name);
        const isNew = !existing || existing.version !== info.version;

        repo.createMod(db, {
          name: info.name || '',
          display_name: info.title || info.name || '',
          version: info.version || '',
          author: info.author || '',
          description: info.description || '',
          category: '',
          is_enabled: existing ? (existing.is_enabled ? 1 : 0) : 1,
          is_installed: 1,
          has_update: existing ? existing.has_update : 0,
          game_version: info.factorio_version || '',
          download_url: '',
          file_path: zipPath,
          dependencies_json: JSON.stringify(info.dependencies || []),
        });

        if (isNew) result.added++;
        else result.synced++;
      } catch (error) {
        console.error(`[syncFromFilesetm] Error processing ${entry}:`, error);
      }
    }

    const allMods = repo.listInstalledMods(db);
    for (const mod of allMods) {
      if (mod.file_path && !existsSync(mod.file_path)) {
        console.log(`[syncFromFilesystem] Removing orphan mod record: ${mod.name} (${mod.file_path})`);
        repo.deleteMod(db, mod.id);
        result.removed++;
      }
    }

    syncModListJson();

    console.log(`[syncFromFilesystem] Sync completed: +${result.added} ~${result.synced} -${result.removed}`);
  } catch (error) {
    console.error('[syncFromFilesystem] Error during sync:', error);
    throw new Error('同步文件系统失败: ' + (error instanceof Error ? error.message : '未知错误'));
  }

  return result;
}
