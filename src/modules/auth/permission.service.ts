import { getDb } from '../../lib/database.js';
import * as repo from './permission.repository.js';

export function getAllPermissions(): repo.PagePermission[] {
  const db = getDb();
  return repo.getAllPagePermissions(db);
}

export function updatePermissions(
  updates: Array<{ page_id: string; visible_to_user: boolean }>
): void {
  const db = getDb();
  const updateMany = db.transaction(
    (items: Array<{ page_id: string; visible_to_user: boolean }>) => {
      for (const item of items) {
        repo.updatePagePermission(db, item.page_id, item.visible_to_user ? 1 : 0);
      }
    }
  );
  updateMany(updates);
}

export function getVisiblePagesForUser(): string[] {
  const db = getDb();
  return repo.getVisiblePageIdsForUser(db);
}