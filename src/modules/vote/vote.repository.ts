import type Database from 'better-sqlite3';

export interface DbVote {
  id: number;
  initiator_id: number;
  target_player: string;
  type: string;
  reason: string;
  status: string;
  yes_votes: number;
  no_votes: number;
  cooldown_until: number | null;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface DbVoteRecord {
  id: number;
  vote_id: number;
  user_id: number;
  vote: string;
  created_at: number;
}

export function getVoteConfig(db: Database.Database): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM vote_config').all() as { key: string; value: string }[];
  const config: Record<string, string> = {};
  for (const row of rows) config[row.key] = row.value;
  if (!config.pass_ratio) config.pass_ratio = '60';
  if (!config.min_votes) config.min_votes = '3';
  if (!config.cooldown_seconds) config.cooldown_seconds = '300';
  return config;
}

export function upsertVoteConfig(db: Database.Database, key: string, value: string): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO vote_config (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, now);
}

export function createVote(db: Database.Database, data: { initiator_id: number; target_player: string; type: string; reason: string; cooldown_until: number | null; expires_at: number | null }): number {
  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare(`
    INSERT INTO votes (initiator_id, target_player, type, reason, status, yes_votes, no_votes, cooldown_until, expires_at, created_at, updated_at)
    VALUES (@initiator_id, @target_player, @type, @reason, 'active', 0, 0, @cooldown_until, @expires_at, @created_at, @updated_at)
  `).run({ ...data, created_at: now, updated_at: now });
  return Number(result.lastInsertRowid);
}

export function findVoteById(db: Database.Database, id: number): DbVote | null {
  const row = db.prepare('SELECT * FROM votes WHERE id = ?').get(id);
  return (row as DbVote) || null;
}

export function findActiveVoteByTarget(db: Database.Database, target_player: string): DbVote | null {
  const row = db.prepare("SELECT * FROM votes WHERE target_player = ? AND status = 'active'").get(target_player);
  return (row as DbVote) || null;
}

export function castVoteRecord(db: Database.Database, vote_id: number, user_id: number, vote: string): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO vote_records (vote_id, user_id, vote, created_at) VALUES (?, ?, ?, ?)').run(vote_id, user_id, vote, now);
}

export function hasUserVoted(db: Database.Database, vote_id: number, user_id: number): boolean {
  const row = db.prepare('SELECT 1 FROM vote_records WHERE vote_id = ? AND user_id = ?').get(vote_id, user_id);
  return row !== undefined;
}

export function incrementVoteCount(db: Database.Database, vote_id: number, vote: string): void {
  if (vote !== 'yes' && vote !== 'no') {
    throw new Error('vote must be "yes" or "no"');
  }
  const col = vote === 'yes' ? 'yes_votes' : 'no_votes';
  db.prepare(`UPDATE votes SET ${col} = ${col} + 1, updated_at = ? WHERE id = ?`).run(Math.floor(Date.now() / 1000), vote_id);
}

export function updateVoteStatus(db: Database.Database, id: number, status: string): void {
  db.prepare('UPDATE votes SET status = ?, updated_at = ? WHERE id = ?').run(status, Math.floor(Date.now() / 1000), id);
}

export function listVotes(db: Database.Database, status?: string, limit = 50, offset = 0): DbVote[] {
  if (status) {
    return db.prepare('SELECT * FROM votes WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(status, limit, offset) as DbVote[];
  }
  return db.prepare('SELECT * FROM votes ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as DbVote[];
}

export function getActiveVotes(db: Database.Database): DbVote[] {
  return db.prepare("SELECT * FROM votes WHERE status = 'active' ORDER BY created_at DESC").all() as DbVote[];
}

export function getExpiredVotes(db: Database.Database, now: number): DbVote[] {
  return db.prepare("SELECT * FROM votes WHERE status = 'active' AND expires_at < ?").all(now) as DbVote[];
}

export function getVoteRecords(db: Database.Database, vote_id: number): DbVoteRecord[] {
  return db.prepare('SELECT * FROM vote_records WHERE vote_id = ? ORDER BY created_at').all(vote_id) as DbVoteRecord[];
}

export function findLatestVoteByInitiator(db: Database.Database, initiator_id: number): DbVote | null {
  const row = db.prepare('SELECT * FROM votes WHERE initiator_id = ? ORDER BY created_at DESC LIMIT 1').get(initiator_id);
  return (row as DbVote) || null;
}
