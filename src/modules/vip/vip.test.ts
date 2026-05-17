import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { registerCors } from '../../plugins/cors.js';
import authRoutes from '../auth/auth.routes.js';
import vipRoutes from './vip.routes.js';
import { closeDb } from '../../lib/database.js';
import { unlinkSync } from 'node:fs';

import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let adminToken: string;
let userToken: string;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-vip-secret';
  process.env.DB_PATH = '/tmp/factorio-web-test-vip.db';
  process.env.CORS_ORIGIN = '*';

  app = Fastify({ logger: false });
  await app.register(registerCors);
  await app.register(authRoutes);
  await app.register(vipRoutes);
  await app.ready();

  const admin = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'vipadmin', password: 'admin123', role: 'admin' },
  });
  adminToken = JSON.parse(admin.body).data.token;

  const userRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'vipuser', password: 'user123456' },
  });
  userToken = JSON.parse(userRes.body).data.token;
});

afterAll(async () => {
  await app.close();
  closeDb();
  try { unlinkSync('/tmp/factorio-web-test-vip.db'); } catch {}
});

describe('VIP Levels', () => {
  let levelId: number;

  it('should create a VIP level', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vip/levels',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: '黄金VIP',
        level: 1,
        price: 99,
        duration_days: 30,
        daily_purchase_limit: 10,
        max_quality_level: 2,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('黄金VIP');
    expect(body.data.level).toBe(1);
    expect(body.data.features).toEqual([]);
    levelId = body.data.id;
  });

  it('should reject duplicate VIP level', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vip/levels',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: '重复VIP', level: 1, price: 888 },
    });

    expect(res.statusCode).toBe(409);
  });

  it('should get all VIP levels', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/vip/levels',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('should get VIP level by id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/vip/levels/${levelId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.name).toBe('黄金VIP');
  });

  it('should update VIP level', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/vip/levels/${levelId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { price: 199, daily_purchase_limit: 20 },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.price).toBe(199);
    expect(body.data.daily_purchase_limit).toBe(20);
  });

  it('should reject create non-admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vip/levels',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { name: '非法VIP', level: 5, price: 9999 },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('VIP User Management', () => {
  beforeAll(async () => {
    await app.inject({
      method: 'POST',
      url: '/api/vip/levels',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: '钻石VIP',
        level: 2,
        price: 299,
        duration_days: 90,
        daily_purchase_limit: 30,
        max_quality_level: 3,
        features: ['专属颜色', '双倍掉落'],
      },
    });
  });

  it('should set user VIP level', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vip/set',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: 'vipuser', vip_level: 1, duration_days: 30 },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.vip_level).toBe(1);
    expect(body.data.expiry).toBeGreaterThan(Date.now() / 1000);
  });

  it('should get VIP users', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/vip/users',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data[0].vip_level).toBeGreaterThan(0);
  });

  it('should reject set VIP with nonexistent level', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vip/set',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: 'vipuser', vip_level: 99 },
    });

    expect(res.statusCode).toBe(404);
  });

  it('should demote user to VIP 0', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vip/set',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: 'vipuser', vip_level: 0 },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.vip_level).toBe(0);
    expect(body.data.expiry).toBe(0);
  });

  it('should reject set VIP by non-admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vip/set',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { username: 'vipuser', vip_level: 1 },
    });

    expect(res.statusCode).toBe(403);
  });

  it('should delete VIP level', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/vip/levels',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const levelId = JSON.parse(list.body).data[0].id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/vip/levels/${levelId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
  });
});
