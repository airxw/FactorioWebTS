import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as service from './auth.service.js';
import * as permissionService from './permission.service.js';
import { signToken } from '../../plugins/jwt.js';
import { authenticate, requireAdmin, extractOptionalUser } from '../../plugins/auth-guard.js';
import {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  updateNameSchema,
  searchUsersSchema,
  createUserSchema,
  bindGameSchema,
} from './auth.schema.js';

function makeToken(user: service.SanitizedUser): string {
  return signToken({
    user_id: user.id,
    username: user.username,
    role: user.role,
    pwd_ver: user.password_version,
  });
}

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ success: false, error: parsed.error.errors[0].message });
    }

    try {
      const user = service.register(parsed.data);
      const safe = service.sanitizeUser(user);
      const token = makeToken(safe);
      return reply.status(201).send({ success: true, data: { user: safe, token } });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply
        .status(err.statusCode || 500)
        .send({ success: false, error: err.message });
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ success: false, error: parsed.error.errors[0].message });
    }

    try {
      const user = service.login(parsed.data);
      const safe = service.sanitizeUser(user);
      const token = makeToken(safe);
      return reply.send({ success: true, data: { user: safe, token } });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply
        .status(err.statusCode || 500)
        .send({ success: false, error: err.message });
    }
  });

  app.get('/api/auth/validate', async (request, reply) => {
    const payload = extractOptionalUser(request);
    if (!payload) {
      return reply.send({ success: true, data: null });
    }

    const user = service.validateSession(payload);
    return reply.send({ success: true, data: user });
  });

  app.get('/api/auth/me', { preHandler: [authenticate] }, async (request, reply) => {
    const user = service.getUserById(request.currentUser.user_id);
    if (!user) {
      return reply.status(401).send({ success: false, error: 'User not found' });
    }
    return reply.send({ success: true, data: user });
  });

  app.post('/api/auth/change-password', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ success: false, error: parsed.error.errors[0].message });
    }

    try {
      service.changePassword(request.currentUser.user_id, parsed.data);
      return reply.send({ success: true, message: 'Password changed' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply
        .status(err.statusCode || 500)
        .send({ success: false, error: err.message });
    }
  });

  app.post('/api/auth/update-name', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = updateNameSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ success: false, error: parsed.error.errors[0].message });
    }

    try {
      service.updateName(request.currentUser.user_id, parsed.data.name);
      return reply.send({ success: true, message: 'Updated' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply
        .status(err.statusCode || 500)
        .send({ success: false, error: err.message });
    }
  });

  app.get('/api/auth/users', { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    const users = service.getAllUsers();
    return reply.send({ success: true, data: users });
  });

  app.post('/api/auth/users/search', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = searchUsersSchema.safeParse(request.body);
    const keyword = parsed.success ? parsed.data.keyword : '';
    const users = service.searchUsers(keyword);
    return reply.send({ success: true, data: users });
  });

  app.post('/api/auth/users/create', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ success: false, error: parsed.error.errors[0].message });
    }

    try {
      const result = service.adminCreateUser(parsed.data);
      return reply.status(201).send({ success: true, data: result });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply
        .status(err.statusCode || 500)
        .send({ success: false, error: err.message });
    }
  });

  app.get('/api/auth/users/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = service.getUserById(parseInt(id, 10));
    if (!user) {
      return reply.status(404).send({ success: false, error: 'User not found' });
    }
    return reply.send({ success: true, data: user });
  });

  app.get('/api/auth/page-permissions', { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    const permissions = permissionService.getAllPermissions();
    return reply.send({ success: true, data: permissions });
  });

  app.put('/api/auth/page-permissions', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const body = request.body as {
      permissions?: Array<{ page_id: string; visible_to_user: boolean }>;
    };

    if (!body.permissions || !Array.isArray(body.permissions)) {
      return reply
        .status(400)
        .send({ success: false, error: 'Invalid params, permissions array required' });
    }

    try {
      permissionService.updatePermissions(body.permissions);
      return reply.send({ success: true, message: 'Permissions updated' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply
        .status(err.statusCode || 500)
        .send({ success: false, error: err.message });
    }
  });

  app.get('/api/auth/my-permissions', { preHandler: [authenticate] }, async (request, reply) => {
    if (request.currentUser.role === 'admin') {
      const allPermissions = permissionService.getAllPermissions();
      const visiblePages = allPermissions.map((p) => p.page_id);
      return reply.send({ success: true, data: { role: 'admin', visible_pages: visiblePages } });
    }

    const visiblePages = permissionService.getVisiblePagesForUser();
    return reply.send({ success: true, data: { role: 'user', visible_pages: visiblePages } });
  });

  app.post('/api/auth/generate-binding-code', { preHandler: [authenticate] }, async (request, reply) => {
    const body = request.body as { player_name?: string };
    if (!body.player_name || !body.player_name.trim()) {
      return reply.status(400).send({ success: false, error: 'Player name is required' });
    }

    try {
      const result = service.generateBindingCode(request.currentUser.user_id, body.player_name.trim());
      return reply.send({ success: true, data: { code: result.code } });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/auth/verify-binding-code', async (request, reply) => {
    const parsed = bindGameSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    }

    try {
      const result = service.verifyBindingCode(parsed.data.binding_code, parsed.data.game_id);
      return reply.send({ success: true, data: result });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/auth/unbind', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const result = service.unbindGame(request.currentUser.user_id);
      return reply.send({ success: true, data: result });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });
}