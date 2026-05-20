import type Database from 'better-sqlite3';

export interface DbUser {
  id: number;
  username: string;
  password_hash: string;
  name: string;
  role: string;
  password_version: number;
  game_id: string | null;
  binding_code: string | null;
  binding_code_expiry: number | null;
  vip_level: number;
  vip_expiry: number | null;
  last_login_ip: string | null;
  last_login_at: number | null;
  login_count: number;
  created_at: number;
  updated_at: number;
}

const selectFields = `
  id, username, password_hash, name, role, password_version,
  game_id, binding_code, vip_level, vip_expiry,
  last_login_ip, last_login_at, login_count,
  created_at, updated_at
`;

function rowToUser(row: unknown): DbUser {
  return row as DbUser;
}

export function findUserById(
  db: Database.Database,
  id: number
): DbUser | null {
  const row = db
    .prepare(`SELECT ${selectFields} FROM users WHERE id = ?`)
    .get(id);
  return row ? rowToUser(row) : null;
}

export function findUserByUsername(
  db: Database.Database,
  username: string
): DbUser | null {
  const row = db
    .prepare(`SELECT ${selectFields} FROM users WHERE username = ?`)
    .get(username);
  return row ? rowToUser(row) : null;
}

export function findUserByGameId(
  db: Database.Database,
  gameId: string
): DbUser | null {
  const row = db
    .prepare(`SELECT ${selectFields} FROM users WHERE game_id = ?`)
    .get(gameId);
  return row ? rowToUser(row) : null;
}

export function findUserByBindingCode(
  db: Database.Database,
  code: string
): DbUser | null {
  const row = db
    .prepare(`SELECT ${selectFields} FROM users WHERE binding_code = ?`)
    .get(code);
  return row ? rowToUser(row) : null;
}

export function createUser(
  db: Database.Database,
  data: {
    username: string;
    password_hash: string;
    name: string;
    role: string;
  }
): number {
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`
    INSERT INTO users (username, password_hash, name, role, created_at, updated_at)
    VALUES (@username, @password_hash, @name, @role, @created_at, @updated_at)
  `);
  const result = stmt.run({
    username: data.username,
    password_hash: data.password_hash,
    name: data.name,
    role: data.role,
    created_at: now,
    updated_at: now,
  });
  return Number(result.lastInsertRowid);
}

export function updateUser(
  db: Database.Database,
  id: number,
  data: Record<string, unknown>
): boolean {
  const allowedFields = [
    'name',
    'password_hash',
    'password_version',
    'role',
    'game_id',
    'binding_code',
    'binding_code_expiry',
    'vip_level',
    'vip_expiry',
    'last_login_ip',
    'last_login_at',
    'login_count',
  ];

  const sets: string[] = [];
  const params: Record<string, unknown> = { id };

  for (const [key, value] of Object.entries(data)) {
    if (allowedFields.includes(key)) {
      sets.push(`${key} = @${key}`);
      params[key] = value;
    }
  }

  sets.push('updated_at = @updated_at');
  params.updated_at = Math.floor(Date.now() / 1000);

  const result = db
    .prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = @id`)
    .run(params);
  return result.changes > 0;
}

export function updateLastLogin(
  db: Database.Database,
  id: number,
  ip: string
): boolean {
  const user = findUserById(db, id);
  if (!user) return false;

  return updateUser(db, id, {
    last_login_ip: ip,
    last_login_at: Math.floor(Date.now() / 1000),
    login_count: (user.login_count || 0) + 1,
  });
}

export function updatePassword(
  db: Database.Database,
  id: number,
  hash: string,
  newVersion: number
): boolean {
  return updateUser(db, id, {
    password_hash: hash,
    password_version: newVersion,
  });
}

export function getAllUsers(db: Database.Database): DbUser[] {
  const rows = db
    .prepare(`SELECT ${selectFields} FROM users ORDER BY created_at DESC`)
    .all();
  return (rows as unknown[]).map(rowToUser);
}

export function searchUsers(
  db: Database.Database,
  keyword: string
): DbUser[] {
  const rows = db
    .prepare(
      `SELECT ${selectFields} FROM users WHERE username LIKE @keyword OR name LIKE @keyword ORDER BY created_at DESC`
    )
    .all({ keyword: `%${keyword}%` });
  return (rows as unknown[]).map(rowToUser);
}

export function userExists(
  db: Database.Database,
  username: string
): boolean {
  const row = db
    .prepare('SELECT 1 FROM users WHERE username = ?')
    .get(username);
  return row !== undefined;
}
