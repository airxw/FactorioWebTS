import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { registerCors } from '../../plugins/cors.js';
import authRoutes from '../auth/auth.routes.js';
import serverRoutes from './server.routes.js';
import { closeDb } from '../../lib/database.js';
import { unlinkSync } from 'node:fs';

import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let adminToken: string;
let userToken: string;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-server-secret';
  process.env.DB_PATH = '/tmp/factorio-web-test-server.db';
  process.env.CORS_ORIGIN = '*';

  app = Fastify({ logger: false });
  await app.register(registerCors);
  await app.register(authRoutes);
  await app.register(serverRoutes);
  await app.ready();

  const adminReg = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'serveradmin', password: 'admin123', role: 'admin' },
  });
  adminToken = JSON.parse(adminReg.body).data.token;

  const userReg = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'serveruser', password: 'user123456' },
  });
  userToken = JSON.parse(userReg.body).data.token;
});

afterAll(async () => {
  await app.close();
  closeDb();
  try { unlinkSync('/tmp/factorio-web-test-server.db'); } catch {}
});

describe('Server Status', () => {
  it('should return server status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/server/status',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.running).toBeDefined();
    expect(body.data.version).toBeDefined();
    expect(body.data.players).toBeDefined();
  });

  it('should reject without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/server/status',
    });

    expect(res.statusCode).toBe(401);
  });

  it('should check is-running', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/server/is-running',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body.data.running).toBe('boolean');
  });
});

describe('Server Control', () => {
  it('should reject start by non-admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/server/start',
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('should start server (admin only)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/server/start',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.message).toBeDefined();
  });

  it('should stop server', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/server/stop',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('should save game', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/server/save',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('should restart server', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/server/restart',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('should validate console command', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/server/console',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { command: '' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('should execute console command', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/server/console',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { command: '/help' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.response).toBeDefined();
  });
});
