import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { registerCors } from '../../plugins/cors.js';
import authRoutes from '../auth/auth.routes.js';
import playerRoutes from './player.routes.js';
import { closeDb } from '../../lib/database.js';
import { unlinkSync } from 'node:fs';

import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let adminToken: string;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-player-secret';
  process.env.DB_PATH = '/tmp/factorio-web-test-player.db';
  process.env.CORS_ORIGIN = '*';

  app = Fastify({ logger: false });
  await app.register(registerCors);
  await app.register(authRoutes);
  await app.register(playerRoutes);
  await app.ready();

  const regRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'playeradmin', password: 'admin123', role: 'admin' },
  });
  adminToken = JSON.parse(regRes.body).data.token;
});

afterAll(async () => {
  await app.close();
  closeDb();
  try { unlinkSync('/tmp/factorio-web-test-player.db'); } catch {}
});

describe('Player - Online', () => {
  it('should reject without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/players/online',
    });

    expect(res.statusCode).toBe(401);
  });

  it('should return player list with auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/players/online',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.players).toBeDefined();
    expect(Array.isArray(body.data.players)).toBe(true);
  });
});

describe('Player - Admin Commands', () => {
  it('should reject kick without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/players/kick',
      payload: { player: 'testplayer', reason: 'test' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('should reject kick by non-admin', async () => {
    const userReg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'playerkick', password: 'kick123456' },
    });
    const userToken = JSON.parse(userReg.body).data.token;

    const res = await app.inject({
      method: 'POST',
      url: '/api/players/kick',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { player: 'testplayer' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('should validate kick request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/players/kick',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { player: '' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('should validate ban request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/players/ban',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { player: '' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('Player - Whitelist', () => {
  it('should get whitelist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/players/whitelist',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('should set whitelist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/players/set-whitelist',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { player: 'testplayer', whitelist: true },
    });

    expect(res.statusCode).toBe(200);
  });
});

describe('Player - Give Item', () => {
  it('should validate give item', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/players/give',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { player: '', item: 'steel-plate' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('should send give command', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/players/give',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { player: 'testplayer', item: 'steel-plate', count: 100 },
    });

    expect(res.statusCode).toBe(200);
  });
});

describe('Player - Chat Commands', () => {
  it('should send whisper', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/players/whisper',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { player: 'testplayer', message: 'hello' },
    });

    expect(res.statusCode).toBe(200);
  });

  it('should validate whisper', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/players/whisper',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { player: '', message: '' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('should send say', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/players/say',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { message: 'Server will restart in 5 minutes' },
    });

    expect(res.statusCode).toBe(200);
  });
});
