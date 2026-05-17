import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { registerCors } from '../../plugins/cors.js';
import authRoutes from '../auth/auth.routes.js';
import shopRoutes from './shop.routes.js';
import vipRoutes from '../vip/vip.routes.js';
import { closeDb } from '../../lib/database.js';
import { unlinkSync } from 'node:fs';

import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let adminToken: string;
let userToken: string;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-shop-secret';
  process.env.DB_PATH = '/tmp/factorio-web-test-shop.db';
  process.env.CORS_ORIGIN = '*';

  app = Fastify({ logger: false });
  await app.register(registerCors);
  await app.register(authRoutes);
  await app.register(shopRoutes);
  await app.register(vipRoutes);
  await app.ready();

  const regRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'adminuser', password: 'admin123', role: 'admin' },
  });
  adminToken = JSON.parse(regRes.body).data.token;

  const userRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'normaluser', password: 'user123456' },
  });
  userToken = JSON.parse(userRes.body).data.token;
});

afterAll(async () => {
  await app.close();
  closeDb();
  try { unlinkSync('/tmp/factorio-web-test-shop.db'); } catch {}
});

describe('Shop Items', () => {
  let itemId: number;

  it('should create an item as admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/shop/items',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: '钢铁', code: 'steel', category: '材料', price: 10, stock: 100 },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('钢铁');
    expect(body.data.code).toBe('steel');
    itemId = body.data.id;
  });

  it('should get all items', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/shop/items',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('should filter items by category', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/shop/items?category=材料',
    });

    const body = JSON.parse(res.body);
    expect(body.data.length).toBe(1);
  });

  it('should get categories', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/shop/categories',
    });

    const body = JSON.parse(res.body);
    expect(body.data).toContain('材料');
  });

  it('should get item by id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/shop/items/${itemId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.name).toBe('钢铁');
  });

  it('should update item', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/shop/items/${itemId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { price: 15, name: '钢板' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.price).toBe(15);
    expect(body.data.name).toBe('钢板');
  });

  it('should reject create non-admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/shop/items',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { name: '铜', code: 'copper', category: '材料', price: 5 },
    });

    expect(res.statusCode).toBe(403);
  });

  it('should delete item', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/shop/items/${itemId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
  });
});

describe('Shop Orders', () => {
  let itemId: number;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/shop/items',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: '弹药', code: 'ammo', category: '武器', price: 50, stock: 1000 },
    });
    itemId = JSON.parse(res.body).data.id;
  });

  it('should create an order', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/shop/orders',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { item_id: itemId, player_name: 'player1', quantity: 10 },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.order_number).toMatch(/^FY\d{18}$/);
    expect(body.data.status).toBe('pending');
  });

  it('should create batch orders', async () => {
    const item2 = await app.inject({
      method: 'POST',
      url: '/api/shop/items',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: '铁板', code: 'iron', category: '材料', price: 5, stock: 500 },
    });
    const id2 = JSON.parse(item2.body).data.id;

    const res = await app.inject({
      method: 'POST',
      url: '/api/shop/orders/batch',
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        items: [
          { item_id: itemId, quantity: 3 },
          { item_id: id2, quantity: 2 },
        ],
        player_name: 'player1',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.item_count).toBe(2);
    expect(body.data.order_numbers.length).toBe(2);
  });

  it('should get my orders', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/shop/orders/my',
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('should filter my orders by status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/shop/orders/my?status=pending',
      headers: { authorization: `Bearer ${userToken}` },
    });

    const body = JSON.parse(res.body);
    expect(body.data.every((o: { status: string }) => o.status === 'pending')).toBe(true);
  });

  it('should validate order by number', async () => {
    const orders = await app.inject({
      method: 'GET',
      url: '/api/shop/orders/my',
      headers: { authorization: `Bearer ${userToken}` },
    });
    const orderNumber = JSON.parse(orders.body).data[0].order_number;

    const res = await app.inject({
      method: 'POST',
      url: '/api/shop/orders/validate',
      payload: { order_number: orderNumber },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.order_number).toBe(orderNumber);
  });

  it('should cancel an order', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/shop/orders',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { item_id: itemId, player_name: 'player2', quantity: 1 },
    });
    const freshOrderId = JSON.parse(create.body).data.order_id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/shop/orders/${freshOrderId}/cancel`,
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('should reject cancel by wrong user', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/shop/orders',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { item_id: itemId, player_name: 'admin_player', quantity: 1 },
    });
    const adminOrderId = JSON.parse(createRes.body).data.order_id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/shop/orders/${adminOrderId}/cancel`,
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('should reject nonexistent item', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/shop/orders',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { item_id: 99999, player_name: 'p1', quantity: 1 },
    });

    expect(res.statusCode).toBe(404);
  });
});
