import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { registerCors } from '../../plugins/cors.js';
import authRoutes from '../auth/auth.routes.js';
import logRoutes from './log.routes.js';
import { closeDb } from '../../lib/database.js';
import { unlinkSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let adminToken: string;
let userToken: string;
const testLogsDir = '/tmp/factorio-test-logs';

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-log-secret';
  process.env.DB_PATH = '/tmp/factorio-web-test-log.db';
  process.env.CORS_ORIGIN = '*';
  process.env.LOGS_PATH = testLogsDir;

  if (!existsSync(testLogsDir)) mkdirSync(testLogsDir, { recursive: true });
  writeFileSync(join(testLogsDir, 'factorio-current.log'), '2024-01-01 00:00:00 [CHAT] player1: hello\n2024-01-01 00:01:00 [WARNING] memory low\n');

  app = Fastify({ logger: false });
  await app.register(registerCors);
  await app.register(authRoutes);
  await app.register(logRoutes);
  await app.ready();

  const adminRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'logadmin', password: 'admin123', role: 'admin' },
  });
  adminToken = JSON.parse(adminRes.body).data.token;

  const userRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'loguser', password: 'user123456' },
  });
  userToken = JSON.parse(userRes.body).data.token;
});

afterAll(async () => {
  await app.close();
  closeDb();
  try { unlinkSync('/tmp/factorio-web-test-log.db'); } catch {}
  try { unlinkSync(join(testLogsDir, 'factorio-current.log')); } catch {}
});

describe('Auth Guard', () => {
  it('should reject tail without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/logs/tail' });
    expect(res.statusCode).toBe(401);
  });

  it('should reject logs history without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/logs' });
    expect(res.statusCode).toBe(401);
  });

  it('should reject log files without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/logs/files' });
    expect(res.statusCode).toBe(401);
  });

  it('should reject non-admin for tail', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/logs/tail',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('should reject non-admin for log files', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/logs/files',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('Log Operations', () => {
  it('should tail log file', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/logs/tail',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });

  it('should tail log with line count', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/logs/tail?lines=10',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toBeDefined();
  });

  it('should respect max line limit', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/logs/tail?lines=99999',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('should get log history', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/logs',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('logs');
    expect(body.data).toHaveProperty('total');
  });

  it('should filter logs by level', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/logs?level=WARNING',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('should search logs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/logs?search=hello',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('should list log files', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/logs/files',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('should reject delete from non-admin', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/logs/factorio-current.log',
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('should delete log file', async () => {
    writeFileSync(join(testLogsDir, 'factorio-deletable.log'), 'temporary log');

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/logs/factorio-deletable.log',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });
});