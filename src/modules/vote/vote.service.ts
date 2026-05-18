import { getDb } from '../../lib/database.js';
import * as repo from './vote.repository.js';
import type { VoteConfigInput, StartVoteInput, CastVoteInput, BanPlayerInput } from './vote.schema.js';
import { sendGameCommand, fireAndForget } from '../../lib/game-command-bus.js';
import { AppError } from '../../types/index.js';
import { logger } from '../../lib/logger.js';

const VOTE_DURATION_SECONDS = 60;

export function getVoteConfig() {
  const raw = repo.getVoteConfig(getDb());
  return {
    pass_ratio: parseInt(raw.pass_ratio || '60', 10),
    min_votes: parseInt(raw.min_votes || '3', 10),
    cooldown_seconds: parseInt(raw.cooldown_seconds || '300', 10),
  };
}

export function updateVoteConfig(data: VoteConfigInput): void {
  const db = getDb();
  const txn = db.transaction(() => {
    if (data.pass_ratio !== undefined) repo.upsertVoteConfig(db, 'pass_ratio', String(data.pass_ratio));
    if (data.min_votes !== undefined) repo.upsertVoteConfig(db, 'min_votes', String(data.min_votes));
    if (data.cooldown_seconds !== undefined) repo.upsertVoteConfig(db, 'cooldown_seconds', String(data.cooldown_seconds));
  });
  txn();
}

export async function startVote(data: StartVoteInput, userId: number): Promise<number> {
  if (!data.target) throw new AppError('Target player is required', 400);

  const db = getDb();
  const config = getVoteConfig();

  const existing = repo.findActiveVoteByTarget(db, data.target);
  if (existing) throw new AppError('This player already has an active vote', 409);

  const latest = repo.findLatestVoteByInitiator(db, userId);
  if (latest && latest.cooldown_until) {
    const now = Math.floor(Date.now() / 1000);
    if (now < latest.cooldown_until) {
      const remaining = Math.ceil((latest.cooldown_until - now) / 60);
      throw new AppError(`Vote cooldown, ${remaining} minutes remaining`, 429);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const cooldown_until = now + config.cooldown_seconds;
  const expires_at = now + VOTE_DURATION_SECONDS;

  const voteId = repo.createVote(db, {
    initiator_id: userId,
    target_player: data.target,
    type: data.type ?? 'kick',
    reason: data.reason ?? '',
    cooldown_until,
    expires_at,
  });

  fireAndForget(`/sc says Vote started to kick ${data.target}!`);

  return voteId;
}

export function castVote(data: CastVoteInput, userId: number): void {
  const db = getDb();

  const vote = repo.findVoteById(db, data.vote_id);
  if (!vote) throw new AppError('Vote not found', 404);
  if (vote.status !== 'active') throw new AppError('Vote has ended', 400);

  const nowSec = Math.floor(Date.now() / 1000);
  if (vote.expires_at && vote.expires_at < nowSec) {
    checkAndResolveVote(data.vote_id);
    throw new AppError('Vote has expired', 400);
  }

  if (repo.hasUserVoted(db, data.vote_id, userId)) {
    throw new AppError('You have already voted', 409);
  }

  repo.castVoteRecord(db, data.vote_id, userId, data.vote);
  repo.incrementVoteCount(db, data.vote_id, data.vote);

  checkAndResolveVote(data.vote_id);
}

export function checkAndResolveVote(voteId: number): void {
  const db = getDb();
  const vote = repo.findVoteById(db, voteId);
  if (!vote || vote.status !== 'active') return;

  const config = getVoteConfig();
  const totalVotes = vote.yes_votes + vote.no_votes;
  const now = Math.floor(Date.now() / 1000);

  if (vote.expires_at && vote.expires_at < now) {
    if (totalVotes < config.min_votes) {
      repo.updateVoteStatus(db, voteId, 'failed');
      return;
    }
    const ratio = totalVotes > 0 ? (vote.yes_votes / totalVotes) * 100 : 0;
    if (ratio >= config.pass_ratio) {
      repo.updateVoteStatus(db, voteId, 'passed');
      fireAndForget(`/kick ${vote.target_player}`);
    } else {
      repo.updateVoteStatus(db, voteId, 'failed');
    }
    return;
  }

  if (totalVotes >= config.min_votes) {
    const ratio = totalVotes > 0 ? (vote.yes_votes / totalVotes) * 100 : 0;
    if (ratio >= config.pass_ratio) {
      repo.updateVoteStatus(db, voteId, 'passed');
      fireAndForget(`/kick ${vote.target_player}`);
    }
  }
}

export function processExpiredVotes(): number {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const expired = repo.getExpiredVotes(db, now);
  for (const vote of expired) {
    checkAndResolveVote(vote.id);
  }
  return expired.length;
}

export function cancelVote(voteId: number): void {
  const db = getDb();
  const vote = repo.findVoteById(db, voteId);
  if (!vote) throw new AppError('Vote not found', 404);
  if (vote.status !== 'active') throw new AppError('Vote has ended', 400);
  repo.updateVoteStatus(db, voteId, 'cancelled');
}

export async function banPlayer(data: BanPlayerInput): Promise<void> {
  if (!data.player_name) throw new AppError('Player name is required', 400);
  const result = await sendGameCommand(`/ban ${data.player_name}${data.reason ? ` ${data.reason}` : ''}`);
  if (!result.ok) {
    throw new AppError('Ban failed: RCON communication error', 500);
  }
}

export function getVotes(query: { status?: string; limit?: number; offset?: number }) {
  return repo.listVotes(getDb(), query.status, query.limit ?? 50, query.offset ?? 0);
}

export function getActiveVotes() {
  return repo.getActiveVotes(getDb());
}

export function getVoteDetail(voteId: number) {
  const db = getDb();
  const vote = repo.findVoteById(db, voteId);
  if (!vote) throw new AppError('Vote not found', 404);

  const records = repo.getVoteRecords(db, voteId);
  const voters = records.map((r) => ({ player_name: `user_${r.user_id}`, vote: r.vote }));

  return { ...vote, voters };
}

export function hasVoted(voteId: number, userId: number): boolean {
  return repo.hasUserVoted(getDb(), voteId, userId);
}