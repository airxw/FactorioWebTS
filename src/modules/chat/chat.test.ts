import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { registerCors } from '../../plugins/cors.js';
import authRoutes from '../auth/auth.routes.js';
import chatRoutes from './chat.routes.js';
import { closeDb } from '../../lib/database.js';
import { unlinkSync } from 'node:fs';

import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let adminToken: string;
let userToken: string;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-chat-secret';
  process.env.DB_PATH = '/tmp/factorio-web-test-chat.db';
  process.env.CORS_ORIGIN = '*';

  app = Fastify({ logger: false });
  await app.register(registerCors);
  await app.register(authRoutes);
  await app.register(chatRoutes);
  await app.ready();

  const adminRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'chatadmin', password: 'admin123', role: 'admin' },
  });
  adminToken = JSON.parse(adminRes.body).data.token;

  const userRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'chatuser', password: 'user123456' },
  });
  userToken = JSON.parse(userRes.body).data.token;
});

afterAll(async () => {
  await app.close();
  closeDb();
  try { unlinkSync('/tmp/factorio-web-test-chat.db'); } catch {}
});

describe('Auth Guard', () => {
  it('should reject access without token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chat/settings',
    });

    expect(res.statusCode).toBe(401);
  });

  it('should reject non-admin access', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chat/settings',
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('Chat Settings', () => {
  it('should get chat settings', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chat/settings',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data).toBeTruthy();
  });

  it('should save chat settings', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/settings',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { global_enabled: '1', log_level: 'info' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });
});

describe('Trigger Responses', () => {
  let triggerId: number;

  it('should create trigger response', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/trigger-responses',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { trigger_text: 'hello', response_text: 'Hi there!', case_sensitive: 0, enabled: 1 },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.id).toBeGreaterThan(0);
    triggerId = body.data.id;
  });

  it('should list trigger responses', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chat/trigger-responses',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('should delete trigger response', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/chat/trigger-responses/${triggerId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('should reject create with empty trigger', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/trigger-responses',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { trigger_text: '', response_text: 'empty' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('should reject delete nonexistent trigger', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/chat/trigger-responses/99999',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('Server Responses', () => {
  it('should save server response', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/server-responses',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { response_key: 'welcome_msg', response_value: 'Welcome to the server!', response_type: 'chat', cooldown_seconds: 10 },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });

  it('should list server responses', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chat/server-responses',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('should delete server response', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/chat/server-responses/welcome_msg',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('should return 404 deleting nonexistent response', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/chat/server-responses/nonexistent_key',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('Periodic Messages', () => {
  let msgId: number;

  it('should create periodic message', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/periodic-messages',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { type: 'chat', content: 'Thanks for playing!', interval_type: 'minutes', interval_value: 30, enabled: 1 },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.id).toBeGreaterThan(0);
    msgId = body.data.id;
  });

  it('should list periodic messages', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chat/periodic-messages',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('should update periodic message', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/chat/periodic-messages/${msgId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { type: 'chat', content: 'Updated message!', interval_type: 'hours', interval_value: 1, enabled: 1 },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });

  it('should toggle periodic message', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/chat/periodic-messages/${msgId}/toggle`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { enabled: 0 },
    });

    expect(res.statusCode).toBe(200);
  });

  it('should delete periodic message', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/chat/periodic-messages/${msgId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('should reject update nonexistent message', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/chat/periodic-messages/99999',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { content: 'This should fail', interval_type: 'minutes', interval_value: 1, enabled: 1 },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('Player Events', () => {
  it('should save player event config', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/player-events',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { event_type: 'join', enabled: 1, message: '{player} joined', target: 'all' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });

  it('should get player events', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chat/player-events',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('should reject invalid event type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/player-events',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { event_type: '', enabled: 1 },
    });

    expect(res.statusCode).toBe(400);
  });
});