import type Database from 'better-sqlite3';

export interface DbCartItem {
  id: number;
  user_id: number;
  item_id: number;
  quantity: number;
  quality_level: number;
  created_at: number;
  updated_at: number;
}

export interface CartItemWithDetails extends DbCartItem {
  name: string;
  name_cn: string;
  code: string;
  price: number;
  category: string;
  stock: number;
}

const cartFields = `c.id, c.user_id, c.item_id, c.quantity, c.quality_level, c.created_at, c.updated_at`;

function toRow<T>(row: unknown): T {
  return row as T;
}

export function findCartByUserId(
  db: Database.Database,
  userId: number
): CartItemWithDetails[] {
  const rows = db
    .prepare(
      `SELECT ${cartFields},
              i.name, i.name_cn, i.code, i.price, i.category, i.stock
       FROM cart_items c
       JOIN shop_items i ON c.item_id = i.id
       WHERE c.user_id = ?
       ORDER BY c.created_at ASC`
    )
    .all(userId);
  return rows.map(toRow<CartItemWithDetails>);
}

export function deleteCartByUserId(
  db: Database.Database,
  userId: number
): void {
  db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(userId);
}

export function insertCartItem(
  db: Database.Database,
  data: {
    user_id: number;
    item_id: number;
    quantity: number;
    quality_level: number;
  }
): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO cart_items (user_id, item_id, quantity, quality_level, created_at, updated_at)
     VALUES (@user_id, @item_id, @quantity, @quality_level, @created_at, @updated_at)`
  ).run({ ...data, created_at: now, updated_at: now });
}