import type Database from 'better-sqlite3';

export interface DbConfigTemplate {
  id: number;
  name: string;
  description: string;
  config_json: string;
  config_type: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export function listTemplates(db: Database.Database): DbConfigTemplate[] {
  return db.prepare('SELECT * FROM config_templates ORDER BY created_at DESC').all() as DbConfigTemplate[];
}

export function findTemplateById(db: Database.Database, id: number): DbConfigTemplate | null {
  const row = db.prepare('SELECT * FROM config_templates WHERE id = ?').get(id);
  return (row as DbConfigTemplate) || null;
}

export function createTemplate(db: Database.Database, data: { name: string; description: string; config_json: string; config_type?: string | null; created_by: string }): number {
  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare(`
    INSERT INTO config_templates (name, description, config_json, config_type, created_by, created_at, updated_at)
    VALUES (@name, @description, @config_json, @config_type, @created_by, @created_at, @updated_at)
  `).run({ ...data, created_at: now, updated_at: now });
  return Number(result.lastInsertRowid);
}

export function deleteTemplate(db: Database.Database, id: number): boolean {
  return db.prepare('DELETE FROM config_templates WHERE id = ?').run(id).changes > 0;
}
