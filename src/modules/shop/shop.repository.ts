import type Database from 'better-sqlite3';

export interface DbShopItem {
  id: number;
  name: string;
  name_cn: string;
  name_en: string;
  code: string;
  category: string;
  description: string;
  price: number;
  stock: number;
  quality_max: number;
  is_active: number;
  image_url: string;
  created_at: number;
  updated_at: number;
}

export interface DbOrder {
  id: number;
  order_number: string;
  user_id: number;
  item_id: number;
  player_name: string;
  quantity: number;
  total_price: number;
  quality_level: number;
  status: 'pending' | 'delivered' | 'cancelled' | 'failed';
  delivery_method: 'cdk' | 'direct';
  cdk_code: string | null;
  delivered_to_player: string | null;
  delivered_at: number | null;
  rcon_command: string | null;
  created_at: number;
  updated_at: number;
}

export interface DbItemRequest {
  id: number;
  user_id: number;
  item_id: number;
  code: string;
  name: string;
  name_cn: string;
  requester: string;
  status: 'pending' | 'approved' | 'rejected';
  quantity: number;
  quality_level: number;
  created_at: number;
  updated_at: number;
}

const shopFields = `id, name, name_cn, name_en, code, category, description, price, stock, quality_max, is_active, image_url, created_at, updated_at`;

const orderFields = `id, order_number, user_id, item_id, player_name, quantity, total_price, quality_level, status, delivery_method, cdk_code, delivered_to_player, delivered_at, rcon_command, created_at, updated_at`;

const itemRequestFields = `id, user_id, item_id, code, name, name_cn, requester, status, quantity, quality_level, created_at, updated_at`;

function generateOrderNumber(): string {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = (now.getMonth() + 1).toString().padStart(2, '0');
  const d = now.getDate().toString().padStart(2, '0');
  const h = now.getHours().toString().padStart(2, '0');
  const n = now.getMinutes().toString().padStart(2, '0');
  const s = now.getSeconds().toString().padStart(2, '0');
  const rand = Math.floor(Math.random() * 1000000)
    .toString()
    .padStart(6, '0');
  return `FY${y}${m}${d}${h}${n}${s}${rand}`;
}

function toRow<T>(row: unknown): T {
  return row as T;
}

export function findAllItems(
  db: Database.Database,
  filters?: { category?: string; activeOnly?: boolean }
): DbShopItem[] {
  let sql = `SELECT ${shopFields} FROM shop_items`;
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters?.category) {
    conditions.push('category = @category');
    params.category = filters.category;
  }
  if (filters?.activeOnly !== false) {
    conditions.push('is_active = 1');
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY category, name';
  return db.prepare(sql).all(params).map(toRow<DbShopItem>);
}

export function findItemById(
  db: Database.Database,
  id: number
): DbShopItem | null {
  const row = db
    .prepare(`SELECT ${shopFields} FROM shop_items WHERE id = ?`)
    .get(id);
  return row ? toRow<DbShopItem>(row) : null;
}

export function findItemByCode(
  db: Database.Database,
  code: string
): DbShopItem | null {
  const row = db
    .prepare(`SELECT ${shopFields} FROM shop_items WHERE code = ?`)
    .get(code);
  return row ? toRow<DbShopItem>(row) : null;
}

export function getCategories(db: Database.Database): string[] {
  const rows = db
    .prepare('SELECT DISTINCT category FROM shop_items WHERE is_active = 1 AND category != \'\' ORDER BY category')
    .all() as { category: string }[];
  return rows.map((r) => r.category);
}

export function createItem(
  db: Database.Database,
  data: {
    name: string;
    name_cn?: string;
    name_en?: string;
    code: string;
    category: string;
    description: string;
    price: number;
    stock: number;
    quality_max: number;
    image_url: string;
  }
): number {
  const now = Math.floor(Date.now() / 1000);
  const result = db
    .prepare(
      `INSERT INTO shop_items (name, name_cn, name_en, code, category, description, price, stock, quality_max, image_url, created_at, updated_at)
       VALUES (@name, @name_cn, @name_en, @code, @category, @description, @price, @stock, @quality_max, @image_url, @created_at, @updated_at)`
    )
    .run({ ...data, created_at: now, updated_at: now });
  return Number(result.lastInsertRowid);
}

export function updateItem(
  db: Database.Database,
  id: number,
  data: Record<string, unknown>
): boolean {
  const allowed = [
    'name', 'name_cn', 'name_en', 'code', 'category', 'description', 'price',
    'stock', 'quality_max', 'is_active', 'image_url',
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
    .prepare(`UPDATE shop_items SET ${sets.join(', ')} WHERE id = @id`)
    .run(params).changes > 0;
}

export function deleteItem(db: Database.Database, id: number): boolean {
  return db.prepare('DELETE FROM shop_items WHERE id = ?').run(id).changes > 0;
}

export function createOrder(
  db: Database.Database,
  data: {
    user_id: number;
    item_id: number;
    player_name: string;
    quantity: number;
    total_price: number;
    quality_level: number;
    delivery_method: 'cdk' | 'direct';
    cdk_code?: string | null;
  }
): number {
  const now = Math.floor(Date.now() / 1000);
  const orderNumber = generateOrderNumber();
  const result = db
    .prepare(
      `INSERT INTO orders (order_number, user_id, item_id, player_name, quantity, total_price, quality_level, delivery_method, cdk_code, created_at, updated_at)
       VALUES (@order_number, @user_id, @item_id, @player_name, @quantity, @total_price, @quality_level, @delivery_method, @cdk_code, @created_at, @updated_at)`
    )
    .run({ order_number: orderNumber, ...data, cdk_code: data.cdk_code ?? null, created_at: now, updated_at: now });
  return Number(result.lastInsertRowid);
}

export function findOrderById(
  db: Database.Database,
  id: number
): DbOrder | null {
  const row = db
    .prepare(`SELECT ${orderFields} FROM orders WHERE id = ?`)
    .get(id);
  return row ? toRow<DbOrder>(row) : null;
}

export function findOrderByNumber(
  db: Database.Database,
  orderNumber: string
): DbOrder | null {
  const row = db
    .prepare(`SELECT ${orderFields} FROM orders WHERE order_number = ?`)
    .get(orderNumber);
  return row ? toRow<DbOrder>(row) : null;
}

export function findOrdersByUserId(
  db: Database.Database,
  userId: number,
  options?: { status?: string; limit?: number; offset?: number }
): DbOrder[] {
  let sql = `SELECT ${orderFields} FROM orders WHERE user_id = @userId`;
  const params: Record<string, unknown> = { userId };

  if (options?.status) {
    sql += ' AND status = @status';
    params.status = options.status;
  }

  sql += ' ORDER BY created_at DESC';

  if (options?.limit) {
    sql += ` LIMIT ${options.limit}`;
    if (options.offset) sql += ` OFFSET ${options.offset}`;
  }

  return db.prepare(sql).all(params).map(toRow<DbOrder>);
}

export function countUserOrdersToday(
  db: Database.Database,
  userId: number
): number {
  const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const row = db
    .prepare(
      'SELECT COUNT(*) as cnt FROM orders WHERE user_id = ? AND created_at >= ?'
    )
    .get(userId, startOfDay) as { cnt: number };
  return row.cnt;
}

export function updateOrderStatus(
  db: Database.Database,
  id: number,
  status: 'pending' | 'delivered' | 'cancelled' | 'failed',
  extra?: { delivered_to_player?: string; delivered_at?: number; rcon_command?: string }
): boolean {
  const sets = ['status = @status', 'updated_at = @updated_at'];
  const params: Record<string, unknown> = {
    id,
    status,
    updated_at: Math.floor(Date.now() / 1000),
  };

  if (extra?.delivered_to_player) {
    sets.push('delivered_to_player = @delivered_to_player');
    params.delivered_to_player = extra.delivered_to_player;
  }
  if (extra?.delivered_at) {
    sets.push('delivered_at = @delivered_at');
    params.delivered_at = extra.delivered_at;
  }
  if (extra?.rcon_command) {
    sets.push('rcon_command = @rcon_command');
    params.rcon_command = extra.rcon_command;
  }

  return db
    .prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = @id`)
    .run(params).changes > 0;
}

export function deleteOrdersByIds(
  db: Database.Database,
  ids: number[],
  userId: number
): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const result = db
    .prepare(`DELETE FROM orders WHERE id IN (${placeholders}) AND user_id = ?`)
    .run(...ids, userId);
  return result.changes;
}

export function findOrdersWithItems(
  db: Database.Database,
  options?: { userId?: number; status?: string; search?: string; limit?: number; offset?: number }
): Array<DbOrder & { item_name: string; item_code: string; item_category: string }> {
  let sql = `SELECT o.*, i.name as item_name, i.code as item_code, i.category as item_category
             FROM orders o LEFT JOIN shop_items i ON o.item_id = i.id`;
  const params: Record<string, unknown> = {};
  const conditions: string[] = [];

  if (options?.userId) {
    conditions.push('o.user_id = @userId');
    params.userId = options.userId;
  }

  if (options?.status) {
    conditions.push('o.status = @status');
    params.status = options.status;
  }

  if (options?.search) {
    conditions.push('(o.order_number LIKE @search OR i.name LIKE @search OR o.player_name LIKE @search OR i.code LIKE @search)');
    params.search = '%' + options.search + '%';
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY o.created_at DESC';

  if (options?.limit) {
    sql += ` LIMIT ${options.limit}`;
    if (options.offset) sql += ` OFFSET ${options.offset}`;
  }

  return (db.prepare(sql).all(params) as Array<DbOrder & { item_name: string; item_code: string; item_category: string }>);
}

export function countOrdersWithItems(
  db: Database.Database,
  options?: { userId?: number; status?: string; search?: string }
): number {
  let sql = `SELECT COUNT(*) as cnt FROM orders o LEFT JOIN shop_items i ON o.item_id = i.id`;
  const params: Record<string, unknown> = {};
  const conditions: string[] = [];

  if (options?.userId) {
    conditions.push('o.user_id = @userId');
    params.userId = options.userId;
  }

  if (options?.status) {
    conditions.push('o.status = @status');
    params.status = options.status;
  }

  if (options?.search) {
    conditions.push('(o.order_number LIKE @search OR i.name LIKE @search OR o.player_name LIKE @search OR i.code LIKE @search)');
    params.search = '%' + options.search + '%';
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  const row = db.prepare(sql).get(params) as { cnt: number };
  return row.cnt;
}

export function findItemRequests(
  db: Database.Database,
  options?: { status?: string }
): DbItemRequest[] {
  let sql = `SELECT ${itemRequestFields} FROM item_requests`;
  const params: Record<string, unknown> = {};

  if (options?.status) {
    sql += ' WHERE status = @status';
    params.status = options.status;
  }

  sql += ' ORDER BY created_at DESC';

  return db.prepare(sql).all(params).map(toRow<DbItemRequest>);
}

export function findItemRequestById(
  db: Database.Database,
  id: number
): DbItemRequest | null {
  const row = db
    .prepare(`SELECT ${itemRequestFields} FROM item_requests WHERE id = ?`)
    .get(id);
  return row ? toRow<DbItemRequest>(row) : null;
}

export function createItemRequest(
  db: Database.Database,
  data: {
    user_id: number;
    item_id: number;
    code: string;
    name: string;
    name_cn: string;
    requester: string;
    quantity: number;
    quality_level: number;
  }
): number {
  const now = Math.floor(Date.now() / 1000);
  const result = db
    .prepare(
      `INSERT INTO item_requests (user_id, item_id, code, name, name_cn, requester, quantity, quality_level, created_at, updated_at)
       VALUES (@user_id, @item_id, @code, @name, @name_cn, @requester, @quantity, @quality_level, @created_at, @updated_at)`
    )
    .run({ ...data, created_at: now, updated_at: now });
  return Number(result.lastInsertRowid);
}

export function updateItemRequestStatus(
  db: Database.Database,
  id: number,
  status: 'pending' | 'approved' | 'rejected'
): boolean {
  const now = Math.floor(Date.now() / 1000);
  return db
    .prepare('UPDATE item_requests SET status = @status, updated_at = @updated_at WHERE id = @id')
    .run({ id, status, updated_at: now }).changes > 0;
}
