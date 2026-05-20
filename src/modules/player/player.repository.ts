import { getDb } from '../../lib/database.js';

export interface DbPlayerHistory {
  id: number;
  player_name: string;
  event_type: string;
  event_data: string;
  created_at: number;
}

export function recordEvent(
  playerName: string,
  eventType: string,
  eventData: Record<string, unknown>
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO player_histories (player_name, event_type, event_data, created_at)
    VALUES (?, ?, ?, ?)
  `).run(playerName, eventType, JSON.stringify(eventData), Math.floor(Date.now() / 1000));
}

export function getPlayerHistory(
  playerName: string,
  limit = 50
): DbPlayerHistory[] {
  const db = getDb();
  return db
    .prepare(
      'SELECT * FROM player_histories WHERE player_name = ? ORDER BY created_at DESC LIMIT ?'
    )
    .all(playerName, limit) as DbPlayerHistory[];
}

export function searchPlayerNames(keyword: string): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT DISTINCT player_name FROM player_histories WHERE player_name LIKE ? ORDER BY player_name LIMIT 20'
    )
    .all(`%${keyword}%`) as { player_name: string }[];
  return rows.map((r) => r.player_name);
}
