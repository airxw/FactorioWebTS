import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { registerCors } from '../../plugins/cors.js';
import authRoutes from './auth.routes.js';
import { getDb, closeDb } from '../../lib/database.js';
import { unlinkSync } from 'node:fs';

import type { FastifyInstance } from 'fastify';

function buildTestApp() {
  return Fastify({ logger: false });
}

let app: FastifyInstance;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-for-auth-tests';
  process.env.DB_PATH = '/tmp/factorio-web-test-auth.db';
  process.env.CORS_ORIGIN = '*';

  app = buildTestApp();
  await app.register(registerCors);
  await app.register(authRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  closeDb();
  try { unlinkSync('/tmp/factorio-web-test-auth.db'); } catch {}
});

describe('Auth - Register', () => {
  it('should register a new user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        username: 'testuser',
        password: 'password123',
        name: 'Test User',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.user.username).toBe('testuser');
    expect(body.data.user.name).toBe('Test User');
    expect(body.data.user.role).toBe('user');
    expect(body.data.token).toBeTruthy();
    expect(body.data.user.password_hash).toBeUndefined();
  });

  it('should reject duplicate username', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'testuser', password: 'password123' },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.error).toContain('已存在');
  });

  it('should reject short username', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'ab', password: 'password123' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('should reject short password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'newuser2', password: '12345' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('should reject invalid username characters', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'user name!', password: 'password123' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('Auth - Login', () => {
  it('should login with correct credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'testuser', password: 'password123' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.user.username).toBe('testuser');
    expect(body.data.token).toBeTruthy();
  });

  it('should reject wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'testuser', password: 'wrongpassword' },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
  });

  it('should reject nonexistent user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'nobody', password: 'password123' },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('Auth - Validate Session', () => {
  let token: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'testuser', password: 'password123' },
    });
    token = JSON.parse(res.body).data.token;
  });

  it('should validate a valid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/validate',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.username).toBe('testuser');
  });

  it('should return null for invalid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/validate',
      headers: { authorization: 'Bearer invalid.token.here' },
    });

    const body = JSON.parse(res.body);
    expect(body.data).toBe(null);
  });

  it('should return null with no token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/validate',
    });

    const body = JSON.parse(res.body);
    expect(body.data).toBe(null);
  });
});

describe('Auth - Me', () => {
  let token: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'testuser', password: 'password123' },
    });
    token = JSON.parse(res.body).data.token;
  });

  it('should return current user with valid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.username).toBe('testuser');
  });

  it('should reject without token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('Auth - Change Password', () => {
  let token: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'testuser', password: 'password123' },
    });
    token = JSON.parse(res.body).data.token;
  });

  it('should change password successfully', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { authorization: `Bearer ${token}` },
      payload: { old_password: 'password123', new_password: 'newpassword456' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });

  it('should be able to login with new password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'testuser', password: 'newpassword456' },
    });

    expect(res.statusCode).toBe(200);
  });

  it('should reject wrong old password', async () => {
    const anotherLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'testuser', password: 'newpassword456' },
    });
    token = JSON.parse(anotherLogin.body).data.token;

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { authorization: `Bearer ${token}` },
      payload: { old_password: 'wrongold', new_password: 'another789' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('Auth - Admin', () => {
  let adminToken: string;

  beforeAll(async () => {
    const db = getDb();
    db.prepare('UPDATE users SET role = ? WHERE username = ?').run(
      'admin',
      'testuser'
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'testuser', password: 'newpassword456' },
    });

    adminToken = JSON.parse(res.body).data.token;
  });

  it('should get all users as admin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/users',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('should search users', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/users/search',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { keyword: 'test' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('should create user as admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/users/create',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: 'createdbyadmin', password: 'adminpass123' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.user_id).toBeGreaterThan(0);
  });

  it('should get user by id', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/auth/users',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const users = JSON.parse(listRes.body).data;
    const adminUser = users.find((u: { username: string }) => u.username === 'testuser');
    const userId = adminUser.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/auth/users/${userId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.id).toBe(userId);
  });

  it('should return 404 for nonexistent user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/users/99999',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});
