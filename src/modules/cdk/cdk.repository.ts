import type Database from 'better-sqlite3';

export interface DbCdkCode {
  code: string;
  command: string;
  status: 'UNUSED' | 'USED';
  item_id: number | null;
  player_name: string | null;
  type: 'shop' | 'vip';
  user_id: number | null;
  created_at: number;
  updated_at: number;
}

const cdkFields = `code, command, status, item_id, player_name, type, user_id, created_at, updated_at`;

export function generateCode(db: Database.Database): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = 'FACTORIO_';
    for (let i = 0; i < 8; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    const exists = db.prepare('SELECT 1 FROM cdk_codes WHERE code = ?').get(code);
    if (!exists) return code;
  }
  const fallback = `FACTORIO_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  return fallback;
}

export function createCode(
  db: Database.Database,
  data: {
    code: string;
    command: string;
    item_id?: number | null;
    player_name?: string | null;
    type?: 'shop' | 'vip';
    user_id?: number | null;
  }
): DbCdkCode {
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`
    INSERT INTO cdk_codes (code, command, status, item_id, player_name, type, user_id, created_at, updated_at)
    VALUES (?, ?, 'UNUSED', ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    data.code,
    data.command,
    data.item_id ?? null,
    data.player_name ?? null,
    data.type ?? 'shop',
    data.user_id ?? null,
    now,
    now
  );
  return findCodeByCode(db, data.code)!;
}

export function findCodeByCode(db: Database.Database, code: string): DbCdkCode | null {
  const row = db.prepare(`SELECT ${cdkFields} FROM cdk_codes WHERE code = ?`).get(code) as DbCdkCode | undefined;
  return row ?? null;
}

export function updateCodeStatus(db: Database.Database, code: string, status: 'UNUSED' | 'USED'): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare('UPDATE cdk_codes SET status = ?, updated_at = ? WHERE code = ?').run(status, now, code);
}
