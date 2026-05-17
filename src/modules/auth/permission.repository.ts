import type Database from 'better-sqlite3';

export interface PagePermission {
  id: number;
  page_id: string;
  label: string;
  visible_to_user: number;
  updated_at: number;
}

function rowToPermission(row: unknown): PagePermission {
  return row as PagePermission;
}

export function getAllPagePermissions(db: Database.Database): PagePermission[] {
  const rows = db
    .prepare('SELECT * FROM page_permissions ORDER BY id')
    .all();
  return (rows as unknown[]).map(rowToPermission);
}

export function updatePagePermission(
  db: Database.Database,
  pageId: string,
  visibleToUser: number
): boolean {
  const now = Math.floor(Date.now() / 1000);
  const result = db
    .prepare(
      'UPDATE page_permissions SET visible_to_user = ?, updated_at = ? WHERE page_id = ?'
    )
    .run(visibleToUser, now, pageId);
  return result.changes > 0;
}

export function getVisiblePageIdsForUser(db: Database.Database): string[] {
  const rows = db
    .prepare(
      "SELECT page_id FROM page_permissions WHERE visible_to_user = 1"
    )
    .all() as { page_id: string }[];
  return rows.map((r) => r.page_id);
}