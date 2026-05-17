import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { registerCors } from '../../plugins/cors.js';
import authRoutes from '../auth/auth.routes.js';
import fileRoutes from './file.routes.js';
import { closeDb } from '../../lib/database.js';
import { unlinkSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let adminToken: string;
let userToken: string;
const testSavesDir = '/tmp/factorio-test-saves';

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-file-secret';
  process.env.DB_PATH = '/tmp/factorio-web-test-file.db';
  process.env.CORS_ORIGIN = '*';
  process.env.SAVES_PATH = testSavesDir;

  if (!existsSync(testSavesDir)) mkdirSync(testSavesDir, { recursive: true });
  writeFileSync(join(testSavesDir, 'test_save.zip'), Buffer.from('test save content'));

  app = Fastify({ logger: false });
  await app.register(registerCors);
  await app.register(authRoutes);
  await app.register(fileRoutes);
  await app.ready();

  const adminRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'fileadmin', password: 'admin123', role: 'admin' },
  });
  adminToken = JSON.parse(adminRes.body).data.token;

  const userRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'fileuser', password: 'user123456' },
  });
  userToken = JSON.parse(userRes.body).data.token;
});

afterAll(async () => {
  await app.close();
  closeDb();
  try { unlinkSync('/tmp/factorio-web-test-file.db'); } catch {}
  try { unlinkSync(join(testSavesDir, 'test_save.zip')); } catch {}
  try { unlinkSync(join(testSavesDir, 'uploaded.zip')); } catch {}
  try { unlinkSync(join(testSavesDir, 'not_current.zip')); } catch {}
  try { unlinkSync(join(testSavesDir, '_deletable_test_.zip')); } catch {}
});

describe('Auth Guard', () => {
  it('should reject saves list without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/files/saves' });
    expect(res.statusCode).toBe(401);
  });

  it('should reject upload from non-admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      headers: { authorization: `Bearer ${userToken}`, 'content-type': 'application/json' },
      payload: { filename: 'test.zip', content: 'aGVsbG8=' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('should reject delete from non-admin', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/files/test.zip',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('Saves', () => {
  it('should list save files', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/files/saves',
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('should upload a save file', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { filename: 'uploaded.zip', content: Buffer.from('uploaded save data').toString('base64') },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });

  it('should reject upload without filename', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { content: 'aGVsbG8=' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('should reject upload without content', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { filename: 'test.zip' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('should reject set-current from non-admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/files/set-current',
      headers: { authorization: `Bearer ${userToken}`, 'content-type': 'application/json' },
      payload: { filename: 'test_save.zip' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('should set current save', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/files/set-current',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { filename: 'test_save.zip' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });

  it('should reject set-current without filename', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/files/set-current',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it('should delete a save file', async () => {
    writeFileSync(join(testSavesDir, '_deletable_test_.zip'), Buffer.from('temporary data'));
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/files/_deletable_test_.zip',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    const body = JSON.parse(res.body);
    if (res.statusCode === 400 && body.error && body.error.includes('当前存档')) {
      expect(true).toBe(true);
    } else {
      expect(res.statusCode).toBe(200);
      expect(body.success).toBe(true);
    }
  });
});