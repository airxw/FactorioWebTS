import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { registerCors } from '../../plugins/cors.js';
import authRoutes from '../auth/auth.routes.js';
import shopRoutes from '../shop/shop.routes.js';
import cartRoutes from './cart.routes.js';
import { closeDb } from '../../lib/database.js';
import { unlinkSync } from 'node:fs';

import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let adminToken: string;
let userToken: string;
let itemId: number;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-cart-secret';
  process.env.DB_PATH = '/tmp/factorio-web-test-cart.db';
  process.env.CORS_ORIGIN = '*';

  app = Fastify({ logger: false });
  await app.register(registerCors);
  await app.register(authRoutes);
  await app.register(shopRoutes);
  await app.register(cartRoutes);
  await app.ready();

  const adminRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'cartadmin', password: 'admin123', role: 'admin' },
  });
  adminToken = JSON.parse(adminRes.body).data.token;

  const userRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'cartuser', password: 'user123456' },
  });
  userToken = JSON.parse(userRes.body).data.token;

  const itemRes = await app.inject({
    method: 'POST',
    url: '/api/shop/items',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { name: '铁板', code: 'iron-plate', category: '材料', price: 5, stock: 500 },
  });
  itemId = JSON.parse(itemRes.body).data.id;
});

afterAll(async () => {
  await app.close();
  closeDb();
  try { unlinkSync('/tmp/factorio-web-test-cart.db'); } catch {}
});

describe('Cart - Get', () => {
  it('should get empty cart initially', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/cart',
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(0);
  });

  it('should reject without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/cart',
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('Cart - Sync', () => {
  it('should sync items to cart', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/cart',
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        items: [
          { item_id: itemId, quantity: 10, quality_level: 1 },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });

  it('should return synced items', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/cart',
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.length).toBe(1);
    expect(body.data[0].item_id).toBe(itemId);
    expect(body.data[0].quantity).toBe(10);
    expect(body.data[0].quality_level).toBe(1);
    expect(body.data[0].name).toBe('铁板');
  });

  it('should replace cart on re-sync', async () => {
    const item2Res = await app.inject({
      method: 'POST',
      url: '/api/shop/items',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: '铜板', code: 'copper-plate', category: '材料', price: 8, stock: 300 },
    });
    const item2Id = JSON.parse(item2Res.body).data.id;

    await app.inject({
      method: 'PUT',
      url: '/api/cart',
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        items: [
          { item_id: item2Id, quantity: 5, quality_level: 2 },
        ],
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/cart',
      headers: { authorization: `Bearer ${userToken}` },
    });

    const body = JSON.parse(res.body);
    expect(body.data.length).toBe(1);
    expect(body.data[0].item_id).toBe(item2Id);
  });

  it('should reject sync without auth', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/cart',
      payload: {
        items: [{ item_id: itemId, quantity: 1, quality_level: 1 }],
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it('should reject sync with invalid payload', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/cart',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { items: [{ item_id: -1, quantity: 0 }] },
    });

    expect(res.statusCode).toBe(400);
  });

  it('should allow empty cart sync', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/cart',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { items: [] },
    });

    expect(res.statusCode).toBe(200);

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/cart',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(JSON.parse(getRes.body).data.length).toBe(0);
  });
});

describe('Cart - Clear', () => {
  beforeAll(async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/cart',
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        items: [{ item_id: itemId, quantity: 3, quality_level: 1 }],
      },
    });
  });

  it('should clear cart', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/cart',
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });

  it('should have empty cart after clear', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/cart',
      headers: { authorization: `Bearer ${userToken}` },
    });

    const body = JSON.parse(res.body);
    expect(body.data.length).toBe(0);
  });

  it('should reject clear without auth', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/cart',
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('Cart - Different Users', () => {
  it('should isolate cart between users', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/cart',
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        items: [{ item_id: itemId, quantity: 1, quality_level: 1 }],
      },
    });

    const adminCart = await app.inject({
      method: 'GET',
      url: '/api/cart',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(JSON.parse(adminCart.body).data.length).toBe(0);

    const userCart = await app.inject({
      method: 'GET',
      url: '/api/cart',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(JSON.parse(userCart.body).data.length).toBe(1);
  });
});