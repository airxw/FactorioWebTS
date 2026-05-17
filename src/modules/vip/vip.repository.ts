import type Database from 'better-sqlite3';

export interface DbVipLevel {
  id: number;
  name: string;
  level: number;
  price: number;
  duration_days: number;
  daily_purchase_limit: number;
  single_purchase_limit: number;
  max_quality_level: number;
  features_json: string;
  is_active: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

const vipFields = `id, name, level, price, duration_days, daily_purchase_limit, single_purchase_limit, max_quality_level, features_json, is_active, sort_order, created_at, updated_at`;

function toRow<T>(row: unknown): T {
  return row as T;
}

export function findAllLevels(
  db: Database.Database,
  activeOnly = true
): DbVipLevel[] {
  let sql = `SELECT ${vipFields} FROM vip_levels`;
  if (activeOnly) sql += ' WHERE is_active = 1';
  sql += ' ORDER BY sort_order, level';
  return db.prepare(sql).all().map(toRow<DbVipLevel>);
}

export function findLevelById(
  db: Database.Database,
  id: number
): DbVipLevel | null {
  const row = db
    .prepare(`SELECT ${vipFields} FROM vip_levels WHERE id = ?`)
    .get(id);
  return row ? toRow<DbVipLevel>(row) : null;
}

export function findLevelByLevel(
  db: Database.Database,
  level: number
): DbVipLevel | null {
  const row = db
    .prepare(`SELECT ${vipFields} FROM vip_levels WHERE level = ?`)
    .get(level);
  return row ? toRow<DbVipLevel>(row) : null;
}

export function createLevel(
  db: Database.Database,
  data: {
    name: string;
    level: number;
    price: number;
    duration_days: number;
    daily_purchase_limit: number;
    single_purchase_limit: number;
    max_quality_level: number;
    features_json: string;
    sort_order: number;
  }
): number {
  const now = Math.floor(Date.now() / 1000);
  const result = db
    .prepare(
      `INSERT INTO vip_levels (name, level, price, duration_days, daily_purchase_limit, single_purchase_limit, max_quality_level, features_json, sort_order, created_at, updated_at)
       VALUES (@name, @level, @price, @duration_days, @daily_purchase_limit, @single_purchase_limit, @max_quality_level, @features_json, @sort_order, @created_at, @updated_at)`
    )
    .run({ ...data, created_at: now, updated_at: now });
  return Number(result.lastInsertRowid);
}

export function updateLevel(
  db: Database.Database,
  id: number,
  data: Record<string, unknown>
): boolean {
  const allowed = [
    'name', 'price', 'duration_days', 'daily_purchase_limit',
    'single_purchase_limit', 'max_quality_level', 'features_json',
    'sort_order', 'is_active',
  ];
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };

  for (const [key, value] of Object.entries(data)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = @${key}`);
      params[key] = value;
    }
  }

  sets.push('updated_at = @updated_at');
  params.updated_at = Math.floor(Date.now() / 1000);

  return db
    .prepare(`UPDATE vip_levels SET ${sets.join(', ')} WHERE id = @id`)
    .run(params).changes > 0;
}

export function deleteLevel(db: Database.Database, id: number): boolean {
  return db.prepare('DELETE FROM vip_levels WHERE id = ?').run(id).changes > 0;
}

export function setUserVip(
  db: Database.Database,
  userId: number,
  vipLevel: number,
  expiry: number
): boolean {
  return db
    .prepare('UPDATE users SET vip_level = @vipLevel, vip_expiry = @expiry, updated_at = @updated_at WHERE id = @userId')
    .run({
      vipLevel,
      expiry,
      updated_at: Math.floor(Date.now() / 1000),
      userId,
    }).changes > 0;
}
