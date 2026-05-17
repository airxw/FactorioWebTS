import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { registerCors } from '../../plugins/cors.js';
import authRoutes from '../auth/auth.routes.js';
import voteRoutes from './vote.routes.js';
import { closeDb } from '../../lib/database.js';
import { unlinkSync } from 'node:fs';

import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let adminToken: string;
let userToken: string;
let otherToken: string;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-vote-secret';
  process.env.DB_PATH = '/tmp/factorio-web-test-vote.db';
  process.env.CORS_ORIGIN = '*';

  app = Fastify({ logger: false });
  await app.register(registerCors);
  await app.register(authRoutes);
  await app.register(voteRoutes);
  await app.ready();

  const adminRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'voteadmin', password: 'admin123', role: 'admin' },
  });
  adminToken = JSON.parse(adminRes.body).data.token;

  const userRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'voteuser', password: 'user123456' },
  });
  userToken = JSON.parse(userRes.body).data.token;

  const otherRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'voteother', password: 'other12345' },
  });
  otherToken = JSON.parse(otherRes.body).data.token;
});

afterAll(async () => {
  await app.close();
  closeDb();
  try { unlinkSync('/tmp/factorio-web-test-vote.db'); } catch {}
});

describe('Vote Config', () => {
  it('should get default vote config', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/vote/config',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('pass_ratio');
    expect(body.data).toHaveProperty('min_votes');
    expect(body.data).toHaveProperty('cooldown_seconds');
  });

  it('should update vote config as admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vote/config',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { pass_ratio: 60, min_votes: 5, cooldown_seconds: 300 },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });

  it('should verify updated config', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/vote/config',
    });

    const body = JSON.parse(res.body);
    expect(body.data.pass_ratio).toBe(60);
    expect(body.data.min_votes).toBe(5);
  });

  it('should reject config update from non-admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vote/config',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { pass_ratio: 80 },
    });

    expect(res.statusCode).toBe(403);
  });

  it('should reject invalid config values', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vote/config',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { pass_ratio: 200 },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('Vote Start', () => {
  let voteId: number;

  it('should start a vote', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vote/start',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { target: 'badplayer', reason: 'griefing', type: 'kick' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.vote_id).toBeGreaterThan(0);
    voteId = body.data.vote_id;
  });

  it('should reject start vote without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vote/start',
      payload: { target: 'badplayer2', reason: 'spam' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('should reject start vote with missing target', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vote/start',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { reason: 'bad' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('should prevent duplicate active vote for same target', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vote/start',
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { target: 'badplayer', reason: 'still griefing' },
    });

    expect(res.statusCode).toBe(409);
  });

  it('should get vote detail', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/vote/detail/${voteId}`,
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toHaveProperty('initiator_id');
    expect(body.data).toHaveProperty('yes_votes');
    expect(body.data).toHaveProperty('no_votes');
    expect(body.data.status).toBe('active');
  });
});

describe('Vote Cast', () => {
  it('should cast a yes vote', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/vote/list',
      headers: { authorization: `Bearer ${userToken}` },
    });
    const votes = JSON.parse(listRes.body).data;
    const activeVote = votes.find((v: { status: string }) => v.status === 'active');
    if (!activeVote) throw new Error('No active vote');

    const res = await app.inject({
      method: 'POST',
      url: '/api/vote/cast',
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { vote_id: activeVote.id, vote: 'yes' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.message).toContain('已记录');
  });

  it('should prevent double voting', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/vote/list',
      headers: { authorization: `Bearer ${otherToken}` },
    });
    const votes = JSON.parse(listRes.body).data;
    const activeVote = votes.find((v: { status: string }) => v.status === 'active');
    if (!activeVote) throw new Error('No active vote');

    const res = await app.inject({
      method: 'POST',
      url: '/api/vote/cast',
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { vote_id: activeVote.id, vote: 'no' },
    });

    expect(res.statusCode).toBe(409);
  });

  it('should reject cast vote without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vote/cast',
      payload: { vote_id: 1, vote: 'yes' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('should reject cast vote on invalid vote_id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vote/cast',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { vote_id: 99999, vote: 'yes' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('should check if user has voted', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/vote/list',
      headers: { authorization: `Bearer ${userToken}` },
    });
    const votes = JSON.parse(listRes.body).data;
    const activeVote = votes.find((v: { status: string }) => v.status === 'active');
    if (!activeVote) throw new Error('No active vote parent');

    const res = await app.inject({
      method: 'GET',
      url: `/api/vote/has-voted/${activeVote.id}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(typeof body.data.has_voted).toBe('boolean');
  });
});

describe('Vote List', () => {
  it('should list votes', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/vote/list',
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('should list active votes', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/vote/active',
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('should filter votes by status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/vote/list?status=active',
      headers: { authorization: `Bearer ${userToken}` },
    });

    const body = JSON.parse(res.body);
    expect(body.data.every((v: { status: string }) => v.status === 'active')).toBe(true);
  });

  it('should reject list without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/vote/list',
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('Vote Admin', () => {
  it('should cancel a vote as admin', async () => {
    const startRes = await app.inject({
      method: 'POST',
      url: '/api/vote/start',
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { target: 'tempcancel', reason: 'testing' },
    });
    const voteId = JSON.parse(startRes.body).data.vote_id;

    const res = await app.inject({
      method: 'POST',
      url: '/api/vote/cancel',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { vote_id: voteId },
    });

    expect(res.statusCode).toBe(200);
  });

  it('should reject cancel by non-admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vote/cancel',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { vote_id: 1 },
    });

    expect(res.statusCode).toBe(403);
  });

  it('should process expired votes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vote/process-expired',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });

  it('should reject ban player from non-admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vote/ban',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { player_name: 'badguy', reason: 'vote result' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('should reject cancel with missing vote_id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vote/cancel',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });
});