import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { registerCors } from '../../plugins/cors.js';
import authRoutes from '../auth/auth.routes.js';
import modRoutes from './mod.routes.js';
import { closeDb, getDb } from '../../lib/database.js';
import { unlinkSync } from 'node:fs';

import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let adminToken: string;
let userToken: string;
let testModId: number;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-mod-secret';
  process.env.DB_PATH = '/tmp/factorio-web-test-mod.db';
  process.env.CORS_ORIGIN = '*';

  app = Fastify({ logger: false });
  await app.register(registerCors);
  await app.register(authRoutes);
  await app.register(modRoutes);
  await app.ready();

  const adminRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'modadmin', password: 'admin123', role: 'admin' },
  });
  adminToken = JSON.parse(adminRes.body).data.token;

  const userRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'moduser', password: 'user123456' },
  });
  userToken = JSON.parse(userRes.body).data.token;

  const db = getDb();
  db.prepare(`INSERT INTO mods (name, version, is_enabled, is_installed, author, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'TestMod', '1.0.0', 1, 1, 'TestAuthor', 'A test mod', Math.floor(Date.now()/1000), Math.floor(Date.now()/1000),
  );
  testModId = (db.prepare('SELECT MAX(id) as id FROM mods').get() as { id: number } | undefined)?.id || 1;
});

afterAll(async () => {
  await app.close();
  closeDb();
  try { unlinkSync('/tmp/factorio-web-test-mod.db'); } catch {}
});

describe('Mod List', () => {
  it('should list installed mods', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/mod/list',
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
      url: '/api/mod/list',
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('Mod Toggle', () => {
  it('should toggle mod enabled state', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mod/toggle',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { mod_id: testModId, enabled: 0 },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });

  it('should verify mod was disabled', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/mod/list',
      headers: { authorization: `Bearer ${userToken}` },
    });

    const body = JSON.parse(res.body);
    const mod = body.data.find((m: { id: number }) => m.id === testModId);
    expect(mod).toBeTruthy();
    expect(mod.enabled).toBe(false);
  });

  it('should toggle mod back on', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mod/toggle',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { mod_id: testModId, enabled: 1 },
    });

    expect(res.statusCode).toBe(200);
  });

  it('should reject toggle from non-admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mod/toggle',
      headers: { authorization: `Bearer ${userToken}`, 'content-type': 'application/json' },
      payload: { mod_id: testModId, enabled: 1 },
    });

    expect(res.statusCode).toBe(403);
  });

  it('should reject toggle with missing mod_id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mod/toggle',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { enabled: 1 },
    });

    expect(res.statusCode).toBe(400);
  });

  it('should return 404 for nonexistent mod', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mod/toggle',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { mod_id: 99999, enabled: 1 },
    });

    expect(res.statusCode).toBe(404);
  });

  it('should get mod dependencies', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/mod/dependencies/${testModId}`,
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toHaveProperty('required');
    expect(body.data).toHaveProperty('optional');
  });

  it('should get mod dependencies returns 404 for unknown mod', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/mod/dependencies/99999',
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('Mod Check Conflicts', () => {
  it('should check conflicts', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mod/check-conflicts',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { mod_ids: [testModId] },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });

  it('should reject conflict check without mod_ids', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mod/check-conflicts',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it('should reject conflict check from non-admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mod/check-conflicts',
      headers: { authorization: `Bearer ${userToken}`, 'content-type': 'application/json' },
      payload: { mod_ids: [testModId] },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('Mod Lifecycle', () => {
  it('should reject uninstall from non-admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mod/uninstall',
      headers: { authorization: `Bearer ${userToken}`, 'content-type': 'application/json' },
      payload: { mod_id: testModId },
    });

    expect(res.statusCode).toBe(403);
  });

  it('should uninstall mod', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mod/uninstall',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { mod_id: testModId },
    });

    expect(res.statusCode).toBe(200);
  });

  it('should fail to uninstall nonexistent mod', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mod/uninstall',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { mod_id: testModId },
    });

    expect(res.statusCode).toBe(404);
  });
});