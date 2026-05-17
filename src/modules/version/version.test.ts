import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';
import { registerCors } from '../../plugins/cors.js';
import authRoutes from '../auth/auth.routes.js';
import versionRoutes from './version.routes.js';
import { closeDb, getDb } from '../../lib/database.js';
import { unlinkSync } from 'node:fs';

import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let adminToken: string;
let userToken: string;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-version-secret';
  process.env.DB_PATH = '/tmp/factorio-web-test-version.db';
  process.env.CORS_ORIGIN = '*';
  process.env.FACTORIO_PATH = '/tmp/factorio-test-version';

  app = Fastify({ logger: false });
  await app.register(registerCors);
  await app.register(authRoutes);
  await app.register(versionRoutes);
  await app.ready();

  const adminRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'veradmin', password: 'admin123', role: 'admin' },
  });
  adminToken = JSON.parse(adminRes.body).data.token;

  const userRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'veruser', password: 'user123456' },
  });
  userToken = JSON.parse(userRes.body).data.token;

  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO versions (version, is_current, installed_at, created_at) VALUES (?, ?, ?, ?)`).run(
    '1.1.100', 1, Math.floor(Date.now()/1000), Math.floor(Date.now()/1000),
  );
  db.prepare(`INSERT OR IGNORE INTO versions (version, is_current, installed_at, created_at) VALUES (?, ?, ?, ?)`).run(
    '2.0.20', 0, Math.floor(Date.now()/1000), Math.floor(Date.now()/1000),
  );
});

afterAll(async () => {
  await app.close();
  closeDb();
  try { unlinkSync('/tmp/factorio-web-test-version.db'); } catch {}
});

describe('Version List', () => {
  it('should list all versions', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/versions',
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('should reject without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/versions',
    });

    expect(res.statusCode).toBe(401);
  });

  it('should get current version', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/versions/current',
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toBeTruthy();
  });

  it('should get latest version', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url === 'https://factorio.com/api/latest-releases') {
        return { json: async () => ({ stable: { headless: '2.0.28' }, experimental: { headless: '2.0.29' } }) };
      }
      throw new Error('Unexpected URL');
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/versions/latest',
      headers: { authorization: `Bearer ${userToken}` },
    });

    vi.unstubAllGlobals();

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toBeTruthy();
    expect(body.data.version).toBe('2.0.28');
  });
});

describe('Version Admin', () => {
  it('should reject set-default from non-admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/versions/set-default',
      headers: { authorization: `Bearer ${userToken}`, 'content-type': 'application/json' },
      payload: { version: '2.0.20' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('should set default version', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/versions/set-default',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { version: '2.0.20' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });

  it('should verify current version switched', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/versions/current',
      headers: { authorization: `Bearer ${userToken}` },
    });

    const body = JSON.parse(res.body);
    expect(body.data.version).toBe('2.0.20');
  });

  it('should reject set-default without version', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/versions/set-default',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it('should reject set-default for nonexistent version', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/versions/set-default',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { version: '99.99.99' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('should reject upgrade from non-admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/versions/upgrade',
      headers: { authorization: `Bearer ${userToken}`, 'content-type': 'application/json' },
      payload: { target_version: '2.0.21', release_type: 'stable' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('should reject invalid version format', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/versions/upgrade',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { target_version: 'invalid', release_type: 'stable' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('should reject delete from non-admin', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/versions/1.1.100',
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('should delete a version', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/versions/1.1.100',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });

  it('should reject delete nonexistent version', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/versions/1.1.100',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});