import type Database from 'better-sqlite3';

export interface DbVersion {
  id: number;
  version: string;
  release_type: string;
  is_current: number;
  backup_path: string;
  file_size: number;
  sha256: string;
  installed_at: number;
  created_at: number;
}

export function listVersions(db: Database.Database): DbVersion[] {
  return db.prepare('SELECT * FROM versions ORDER BY installed_at DESC').all() as DbVersion[];
}

export function findVersionByVersion(db: Database.Database, version: string): DbVersion | null {
  const row = db.prepare('SELECT * FROM versions WHERE version = ?').get(version);
  return (row as DbVersion) || null;
}

export function findVersionById(db: Database.Database, id: number): DbVersion | null {
  const row = db.prepare('SELECT * FROM versions WHERE id = ?').get(id);
  return (row as DbVersion) || null;
}

export function getCurrentVersion(db: Database.Database): DbVersion | null {
  const row = db.prepare('SELECT * FROM versions WHERE is_current = 1').get();
  return (row as DbVersion) || null;
}

export function createVersion(db: Database.Database, data: Omit<DbVersion, 'id' | 'created_at'>): number {
  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare(`
    INSERT INTO versions (version, release_type, is_current, backup_path, file_size, sha256, installed_at, created_at)
    VALUES (@version, @release_type, @is_current, @backup_path, @file_size, @sha256, @installed_at, @created_at)
  `).run({ ...data, created_at: now });
  return Number(result.lastInsertRowid);
}

export function updateVersionCurrent(db: Database.Database, id: number, is_current: number): void {
  db.prepare('UPDATE versions SET is_current = ? WHERE id = ?').run(is_current, id);
}

export function setAllVersionsNotCurrent(db: Database.Database): void {
  db.prepare('UPDATE versions SET is_current = 0').run();
}

export function deleteVersion(db: Database.Database, id: number): boolean {
  return db.prepare('DELETE FROM versions WHERE id = ?').run(id).changes > 0;
}
