import type Database from 'better-sqlite3';

export interface DbMod {
  id: number;
  name: string;
  display_name: string;
  version: string;
  author: string;
  description: string;
  category: string;
  is_enabled: number;
  is_installed: number;
  has_update: number;
  game_version: string;
  download_url: string;
  file_path: string;
  dependencies_json: string;
  created_at: number;
  updated_at: number;
}

export function listInstalledMods(db: Database.Database): DbMod[] {
  return db.prepare('SELECT * FROM mods WHERE is_installed = 1 ORDER BY name').all() as DbMod[];
}

export function findModByName(db: Database.Database, name: string): DbMod | null {
  const row = db.prepare('SELECT * FROM mods WHERE name = ?').get(name);
  return (row as DbMod) || null;
}

export function findModById(db: Database.Database, id: number): DbMod | null {
  const row = db.prepare('SELECT * FROM mods WHERE id = ?').get(id);
  return (row as DbMod) || null;
}

export function createMod(db: Database.Database, data: Omit<DbMod, 'id' | 'created_at' | 'updated_at'>): number {
  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare(`
    INSERT INTO mods (name, display_name, version, author, description, category, is_enabled, is_installed, has_update, game_version, download_url, file_path, dependencies_json, created_at, updated_at)
    VALUES (@name, @display_name, @version, @author, @description, @category, @is_enabled, @is_installed, @has_update, @game_version, @download_url, @file_path, @dependencies_json, @created_at, @updated_at)
    ON CONFLICT(name, version) DO UPDATE SET display_name = excluded.display_name, author = excluded.author, description = excluded.description, category = excluded.category, download_url = excluded.download_url, updated_at = excluded.updated_at
  `).run({ ...data, created_at: now, updated_at: now });
  return Number(result.lastInsertRowid);
}

export function updateModEnabled(db: Database.Database, id: number, enabled: number): boolean {
  return db.prepare('UPDATE mods SET is_enabled = ?, updated_at = ? WHERE id = ?').run(enabled, Math.floor(Date.now() / 1000), id).changes > 0;
}

export function deleteMod(db: Database.Database, id: number): boolean {
  return db.prepare('DELETE FROM mods WHERE id = ?').run(id).changes > 0;
}

export function updateModHasUpdate(db: Database.Database, id: number, has_update: number): void {
  db.prepare('UPDATE mods SET has_update = ?, updated_at = ? WHERE id = ?').run(has_update, Math.floor(Date.now() / 1000), id);
}

export function resetAllHasUpdate(db: Database.Database): void {
  db.prepare('UPDATE mods SET has_update = 0').run();
}
