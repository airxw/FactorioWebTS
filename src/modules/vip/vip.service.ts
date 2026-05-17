import { getDb } from '../../lib/database.js';
import * as repo from './vip.repository.js';
import * as authRepo from '../auth/auth.repository.js';
import type { DbVipLevel } from './vip.repository.js';
import type {
  CreateVipLevelInput,
  UpdateVipLevelInput,
  SetUserVipInput,
} from './vip.schema.js';
import { AppError } from '../../types/index.js';
export function getLevels(activeOnly = true): DbVipLevel[] {
  const db = getDb();
  return repo.findAllLevels(db, activeOnly);
}

export function getLevelById(id: number): DbVipLevel | null {
  const db = getDb();
  return repo.findLevelById(db, id);
}

export function createLevel(data: CreateVipLevelInput): DbVipLevel {
  const db = getDb();

  const existing = repo.findLevelByLevel(db, data.level);
  if (existing) {
    throw new AppError(`VIP等级 ${data.level} 已存在`, 409);
  }

  const id = repo.createLevel(db, {
    name: data.name,
    level: data.level,
    price: data.price,
    duration_days: data.duration_days,
    daily_purchase_limit: data.daily_purchase_limit,
    single_purchase_limit: data.single_purchase_limit,
    max_quality_level: data.max_quality_level,
    features_json: JSON.stringify(data.features),
    sort_order: data.sort_order,
  });

  return repo.findLevelById(db, id)!;
}

export function updateLevel(
  id: number,
  data: UpdateVipLevelInput
): DbVipLevel {
  const db = getDb();
  const existing = repo.findLevelById(db, id);
  if (!existing) throw new AppError('VIP等级不存在', 404);

  const updateData: Record<string, unknown> = { ...data };
  if (data.features) {
    updateData.features_json = JSON.stringify(data.features);
    delete updateData.features;
  }

  repo.updateLevel(db, id, updateData);
  return repo.findLevelById(db, id)!;
}

export function deleteLevel(id: number): void {
  const db = getDb();
  const exists = repo.findLevelById(db, id);
  if (!exists) throw new AppError('VIP等级不存在', 404);
  repo.deleteLevel(db, id);
}

export function setUserVip(data: SetUserVipInput): { user_id: number; username: string; vip_level: number; expiry: number } {
  const db = getDb();

  const user = authRepo.findUserByUsername(db, data.username);
  if (!user) throw new AppError('用户不存在', 404);

  if (data.vip_level === 0) {
    repo.setUserVip(db, user.id, 0, 0);
    return { user_id: user.id, username: user.username, vip_level: 0, expiry: 0 };
  }

  const level = repo.findLevelByLevel(db, data.vip_level);
  if (!level) throw new AppError('VIP等级不存在', 404);

  const days = data.duration_days ?? level.duration_days;
  const now = Math.floor(Date.now() / 1000);
  const existingExpiry = user.vip_expiry ?? 0;

  let expiry: number;
  if (existingExpiry > now) {
    expiry = existingExpiry + days * 86400;
  } else {
    expiry = now + days * 86400;
  }

  repo.setUserVip(db, user.id, data.vip_level, expiry);

  return { user_id: user.id, username: user.username, vip_level: data.vip_level, expiry };
}

export function getVipUsers(): Array<{
  id: number;
  username: string;
  name: string;
  vip_level: number;
  vip_expiry: number | null;
  vip_name: string | null;
  status: string;
}> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.name, u.vip_level, u.vip_expiry, vl.name as vip_name
       FROM users u
       LEFT JOIN vip_levels vl ON u.vip_level = vl.level
       WHERE u.vip_level > 0
       ORDER BY u.vip_level DESC, u.username`
    )
    .all() as Array<{
    id: number;
    username: string;
    name: string;
    vip_level: number;
    vip_expiry: number | null;
    vip_name: string | null;
  }>;
  return rows.map((r) => ({
    ...r,
    status: r.vip_expiry && r.vip_expiry > now ? 'active' : 'expired',
  }));
}
