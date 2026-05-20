import { getDb } from '../../lib/database.js';
import * as repo from './cart.repository.js';

export function getCart(userId: number): repo.CartItemWithDetails[] {
  const db = getDb();
  return repo.findCartByUserId(db, userId);
}

export function syncCart(
  userId: number,
  items: Array<{ item_id: number; quantity: number; quality_level: number }>
): void {
  const db = getDb();

  const transaction = db.transaction(() => {
    repo.deleteCartByUserId(db, userId);

    for (const item of items) {
      repo.insertCartItem(db, {
        user_id: userId,
        item_id: item.item_id,
        quantity: item.quantity,
        quality_level: item.quality_level,
      });
    }
  });

  transaction();
}

export function clearCart(userId: number): void {
  const db = getDb();
  repo.deleteCartByUserId(db, userId);
}