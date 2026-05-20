import type Database from 'better-sqlite3';

export interface DbTriggerResponse {
  id: number;
  trigger_text: string;
  response_text: string;
  case_sensitive: number;
  enabled: number;
  created_at: number;
  updated_at: number;
}

export interface DbServerResponse {
  id: number;
  response_key: string;
  response_value: string;
  response_type: string;
  cooldown_seconds: number;
  updated_at: number;
}

export interface DbPeriodicMessage {
  id: number;
  type: string;
  content: string;
  item_code: string;
  item_count: number;
  interval_type: string;
  interval_value: number;
  target: string;
  enabled: number;
  created_at: number;
  updated_at: number;
}

export interface DbChatSetting {
  id: number;
  key: string;
  value: string;
  updated_at: number;
}

export interface DbPlayerEvent {
  id: number;
  event_type: string;
  enabled: number;
  message: string;
  target: string;
  updated_at: number;
}

export function getChatSettings(db: Database.Database): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM chat_settings').all() as { key: string; value: string }[];
  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.key] = row.value;
  return settings;
}

export function upsertChatSetting(db: Database.Database, key: string, value: string): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO chat_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, now);
}

export function listTriggerResponses(db: Database.Database): DbTriggerResponse[] {
  return db.prepare('SELECT * FROM trigger_responses ORDER BY created_at DESC').all() as DbTriggerResponse[];
}

export function addTriggerResponse(db: Database.Database, data: { trigger_text: string; response_text: string; case_sensitive: number; enabled: number }): number {
  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare(`
    INSERT INTO trigger_responses (trigger_text, response_text, case_sensitive, enabled, created_at, updated_at)
    VALUES (@trigger_text, @response_text, @case_sensitive, @enabled, @created_at, @updated_at)
  `).run({ ...data, created_at: now, updated_at: now });
  return Number(result.lastInsertRowid);
}

export function deleteTriggerResponse(db: Database.Database, id: number): boolean {
  return db.prepare('DELETE FROM trigger_responses WHERE id = ?').run(id).changes > 0;
}

export function updateTriggerResponse(db: Database.Database, id: number, data: { trigger_text?: string; response_text?: string; case_sensitive?: number; enabled?: number }): boolean {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null) {
      sets.push(`${key} = @${key}`);
      params[key] = value;
    }
  }
  if (sets.length === 0) return false;
  sets.push('updated_at = @updated_at');
  params.updated_at = Math.floor(Date.now() / 1000);
  return db.prepare(`UPDATE trigger_responses SET ${sets.join(', ')} WHERE id = @id`).run(params).changes > 0;
}

export function listServerResponses(db: Database.Database): DbServerResponse[] {
  return db.prepare('SELECT * FROM server_responses ORDER BY response_key').all() as DbServerResponse[];
}

export function upsertServerResponse(db: Database.Database, data: { response_key: string; response_value: string; response_type: string; cooldown_seconds: number }): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO server_responses (response_key, response_value, response_type, cooldown_seconds, updated_at)
    VALUES (@response_key, @response_value, @response_type, @cooldown_seconds, @updated_at)
    ON CONFLICT(response_key) DO UPDATE SET response_value = excluded.response_value, response_type = excluded.response_type, cooldown_seconds = excluded.cooldown_seconds, updated_at = excluded.updated_at
  `).run({ ...data, updated_at: now });
}

export function deleteServerResponse(db: Database.Database, response_key: string): boolean {
  return db.prepare('DELETE FROM server_responses WHERE response_key = ?').run(response_key).changes > 0;
}

export function listPeriodicMessages(db: Database.Database): DbPeriodicMessage[] {
  return db.prepare('SELECT * FROM periodic_messages ORDER BY created_at DESC').all() as DbPeriodicMessage[];
}

export function addPeriodicMessage(db: Database.Database, data: Omit<DbPeriodicMessage, 'id' | 'created_at' | 'updated_at'>): number {
  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare(`
    INSERT INTO periodic_messages (type, content, item_code, item_count, interval_type, interval_value, target, enabled, created_at, updated_at)
    VALUES (@type, @content, @item_code, @item_count, @interval_type, @interval_value, @target, @enabled, @created_at, @updated_at)
  `).run({ ...data, created_at: now, updated_at: now });
  return Number(result.lastInsertRowid);
}

export function updatePeriodicMessage(db: Database.Database, id: number, data: Partial<Omit<DbPeriodicMessage, 'id' | 'created_at' | 'updated_at'>>): boolean {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null) {
      sets.push(`${key} = @${key}`);
      params[key] = value;
    }
  }
  if (sets.length === 0) return false;
  sets.push('updated_at = @updated_at');
  params.updated_at = Math.floor(Date.now() / 1000);
  return db.prepare(`UPDATE periodic_messages SET ${sets.join(', ')} WHERE id = @id`).run(params).changes > 0;
}

export function deletePeriodicMessage(db: Database.Database, id: number): boolean {
  return db.prepare('DELETE FROM periodic_messages WHERE id = ?').run(id).changes > 0;
}

export function togglePeriodicMessage(db: Database.Database, id: number, enabled: number): boolean {
  return updatePeriodicMessage(db, id, { enabled });
}

export function getPlayerEvents(db: Database.Database): DbPlayerEvent[] {
  return db.prepare('SELECT * FROM chat_player_events ORDER BY event_type').all() as DbPlayerEvent[];
}

export interface DbGiftClaim {
  id: number;
  player_name: string;
  gift_type: string;
  items_json: string;
  claimed_at: number;
}

export function hasGiftClaim(db: Database.Database, playerName: string, giftType: string): boolean {
  const row = db.prepare('SELECT id FROM gift_claims WHERE player_name = ? AND gift_type = ? LIMIT 1').get(playerName, giftType) as { id: number } | undefined;
  return !!row;
}

export function countGiftClaimsSince(db: Database.Database, playerName: string, giftType: string, sinceTimestamp: number): number {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM gift_claims WHERE player_name = ? AND gift_type = ? AND claimed_at >= ?').get(playerName, giftType, sinceTimestamp) as { cnt: number };
  return row.cnt;
}

export function countGiftClaimsTotal(db: Database.Database, playerName: string, giftType: string): number {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM gift_claims WHERE player_name = ? AND gift_type = ?').get(playerName, giftType) as { cnt: number };
  return row.cnt;
}

export function getLastGiftClaimTime(db: Database.Database, playerName: string, giftType: string): number {
  const row = db.prepare('SELECT claimed_at FROM gift_claims WHERE player_name = ? AND gift_type = ? ORDER BY claimed_at DESC LIMIT 1').get(playerName, giftType) as { claimed_at: number } | undefined;
  return row ? row.claimed_at : 0;
}

export function addGiftClaim(db: Database.Database, playerName: string, giftType: string, itemsJson: string): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO gift_claims (player_name, gift_type, items_json, claimed_at) VALUES (?, ?, ?, ?)').run(playerName, giftType, itemsJson, now);
}

export function hasPlayerLoginEvent(db: Database.Database, playerName: string): boolean {
  const row = db.prepare("SELECT id FROM player_histories WHERE player_name = ? AND event_type = 'login' LIMIT 1").get(playerName) as { id: number } | undefined;
  return !!row;
}

export function upsertPlayerEvent(db: Database.Database, data: { event_type: string; enabled: number; message: string; target: string }): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO chat_player_events (event_type, enabled, message, target, updated_at)
    VALUES (@event_type, @enabled, @message, @target, @updated_at)
    ON CONFLICT(event_type) DO UPDATE SET enabled = excluded.enabled, message = excluded.message, target = excluded.target, updated_at = excluded.updated_at
  `).run({ ...data, updated_at: now });
}

export function getLastLogoutTime(db: Database.Database, playerName: string): number {
  const row = db.prepare("SELECT created_at FROM player_histories WHERE player_name = ? AND event_type = 'logout' ORDER BY created_at DESC LIMIT 1").get(playerName) as { created_at: number } | undefined;
  return row ? row.created_at : 0;
}

export interface DbFirstJoinPlayer {
  player_name: string;
  first_join_at: number;
  gift_claimed: number;
  gift_claimed_at: number | null;
}

export function listFirstJoinPlayers(db: Database.Database): DbFirstJoinPlayer[] {
  return db.prepare(`
    SELECT ph.player_name, MIN(ph.created_at) as first_join_at,
      CASE WHEN gc.id IS NOT NULL THEN 1 ELSE 0 END as gift_claimed,
      gc.claimed_at as gift_claimed_at
    FROM player_histories ph
    LEFT JOIN gift_claims gc ON gc.player_name = ph.player_name AND gc.gift_type = 'first'
    WHERE ph.event_type = 'login'
    GROUP BY ph.player_name
    ORDER BY first_join_at DESC
  `).all() as DbFirstJoinPlayer[];
}

export function resetFirstJoinPlayer(db: Database.Database, playerName: string): { deleted_events: number; deleted_gifts: number } {
  const deletedEvents = db.prepare("DELETE FROM player_histories WHERE player_name = ?").run(playerName).changes;
  const deletedGifts = db.prepare("DELETE FROM gift_claims WHERE player_name = ?").run(playerName).changes;
  return { deleted_events: deletedEvents, deleted_gifts: deletedGifts };
}
