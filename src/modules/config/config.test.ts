import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { registerCors } from '../../plugins/cors.js';
import authRoutes from '../auth/auth.routes.js';
import configRoutes from './config.routes.js';
import { closeDb } from '../../lib/database.js';
import { unlinkSync } from 'node:fs';

import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let adminToken: string;
let userToken: string;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-config-secret';
  process.env.DB_PATH = '/tmp/factorio-web-test-config.db';
  process.env.CORS_ORIGIN = '*';

  app = Fastify({ logger: false });
  await app.register(registerCors);
  await app.register(authRoutes);
  await app.register(configRoutes);
  await app.ready();

  const adminRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'configadmin', password: 'admin123', role: 'admin' },
  });
  adminToken = JSON.parse(adminRes.body).data.token;

  const userRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'configuser', password: 'user123456' },
  });
  userToken = JSON.parse(userRes.body).data.token;
});

afterAll(async () => {
  await app.close();
  closeDb();
  try { unlinkSync('/tmp/factorio-web-test-config.db'); } catch {}
});

describe('Auth Guard', () => {
  it('should reject without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config/files' });
    expect(res.statusCode).toBe(401);
  });

  it('should reject non-admin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/config/files',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('Config Files', () => {
  it('should list config files', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/config/files',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('files');
  });

  it('should reject get config without file_type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/config/get',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(400);
  });

  it('should get config for valid file_type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/config/get?file_type=server-settings',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });

  it('should reject save without file_type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/config/save',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { content: '{}' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('should reject validate without file_type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/config/validate',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { content: '{}' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('Config Templates', () => {
  let templateId: number;

  it('should create a template', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/config/templates',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { name: '默认配置', description: '默认服务器配置模板', config: '{"port": 34197}' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.id).toBeGreaterThan(0);
    templateId = body.data.id;
  });

  it('should list templates', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/config/templates',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.templates.length).toBeGreaterThanOrEqual(1);
  });

  it('should get template by id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/config/templates/${templateId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.name).toBe('默认配置');
  });

  it('should return 404 for nonexistent template', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/config/templates/99999',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('should reject create with empty name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/config/templates',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { name: '', description: 'empty', config: '{}' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('should reject create from non-admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/config/templates',
      headers: { authorization: `Bearer ${userToken}`, 'content-type': 'application/json' },
      payload: { name: '非法模板', config: '{}' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('should delete template', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/config/templates/${templateId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });

  it('should return 404 deleting nonexistent template', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/config/templates/${templateId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('should fail apply nonexistent template', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/config/templates/99999/apply',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});