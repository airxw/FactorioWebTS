import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as service from './auth.service.js';
import * as permissionService from './permission.service.js';
import { signToken, verifyToken } from '../../plugins/jwt.js';
import type { JwtPayload } from '../../plugins/jwt.js';
import {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  updateNameSchema,
  searchUsersSchema,
  createUserSchema,
  bindGameSchema,
} from './auth.schema.js';

async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<JwtPayload> {
  const authHeader = request.headers.authorization;
  if (!authHeader) {
    reply.status(401).send({ success: false, error: '缺少认证令牌' });
    throw new Error();
  }

  const token = authHeader.replace(/^Bearer\s+/i, '');

  try {
    return verifyToken(token);
  } catch {
    reply.status(401).send({ success: false, error: '令牌无效或已过期' });
    throw new Error();
  }
}

function extractAndVerifyToken(request: FastifyRequest): JwtPayload | null {
  const header = request.headers.authorization || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!token) return null;

  try {
    return verifyToken(token);
  } catch {
    return null;
  }
}

function requireAdmin(payload: JwtPayload, reply: FastifyReply): void {
  if (payload.role !== 'admin') {
    reply.status(403).send({ success: false, error: '权限不足，需要管理员角色' });
    throw new Error();
  }
}

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
    const payload = extractAndVerifyToken(request);
    if (!payload) {
      return reply.send({ success: true, data: null });
    }

    const user = service.validateSession(payload);
    return reply.send({ success: true, data: user });
  });

  app.get('/api/auth/me', async (request, reply) => {
    try {
      const payload = await authenticate(request, reply);
      const user = service.getUserById(payload.user_id);
      if (!user) {
        return reply.status(401).send({ success: false, error: '用户不存在' });
      }
      return reply.send({ success: true, data: user });
    } catch {
      return;
    }
  });

  app.post('/api/auth/change-password', async (request, reply) => {
    let payload;
    try {
      payload = await authenticate(request, reply);
    } catch {
      return;
    }

    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ success: false, error: parsed.error.errors[0].message });
    }

    try {
      service.changePassword(payload.user_id, parsed.data);
      return reply.send({ success: true, message: '密码修改成功' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply
        .status(err.statusCode || 500)
        .send({ success: false, error: err.message });
    }
  });

  app.post('/api/auth/update-name', async (request, reply) => {
    let payload;
    try {
      payload = await authenticate(request, reply);
    } catch {
      return;
    }

    const parsed = updateNameSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ success: false, error: parsed.error.errors[0].message });
    }

    try {
      service.updateName(payload.user_id, parsed.data.name);
      return reply.send({ success: true, message: '更新成功' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply
        .status(err.statusCode || 500)
        .send({ success: false, error: err.message });
    }
  });

  app.get('/api/auth/users', async (request, reply) => {
    let payload;
    try {
      payload = await authenticate(request, reply);
    } catch {
      return;
    }

    try {
      requireAdmin(payload, reply);
    } catch {
      return;
    }

    const users = service.getAllUsers();
    return reply.send({ success: true, data: users });
  });

  app.post('/api/auth/users/search', async (request, reply) => {
    let payload;
    try {
      payload = await authenticate(request, reply);
    } catch {
      return;
    }

    try {
      requireAdmin(payload, reply);
    } catch {
      return;
    }

    const parsed = searchUsersSchema.safeParse(request.body);
    const keyword = parsed.success ? parsed.data.keyword : '';
    const users = service.searchUsers(keyword);
    return reply.send({ success: true, data: users });
  });

  app.post('/api/auth/users/create', async (request, reply) => {
    let payload;
    try {
      payload = await authenticate(request, reply);
    } catch {
      return;
    }

    try {
      requireAdmin(payload, reply);
    } catch {
      return;
    }

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

  app.get('/api/auth/users/:id', async (request, reply) => {
    let payload;
    try {
      payload = await authenticate(request, reply);
    } catch {
      return;
    }

    try {
      requireAdmin(payload, reply);
    } catch {
      return;
    }

    const { id } = request.params as { id: string };
    const user = service.getUserById(parseInt(id, 10));
    if (!user) {
      return reply.status(404).send({ success: false, error: '用户不存在' });
    }
    return reply.send({ success: true, data: user });
  });

  app.get('/api/auth/page-permissions', async (request, reply) => {
    let payload;
    try {
      payload = await authenticate(request, reply);
    } catch {
      return;
    }

    try {
      requireAdmin(payload, reply);
    } catch {
      return;
    }

    const permissions = permissionService.getAllPermissions();
    return reply.send({ success: true, data: permissions });
  });

  app.put('/api/auth/page-permissions', async (request, reply) => {
    let payload;
    try {
      payload = await authenticate(request, reply);
    } catch {
      return;
    }

    try {
      requireAdmin(payload, reply);
    } catch {
      return;
    }

    const body = request.body as {
      permissions?: Array<{ page_id: string; visible_to_user: boolean }>;
    };

    if (!body.permissions || !Array.isArray(body.permissions)) {
      return reply
        .status(400)
        .send({ success: false, error: '参数错误，需要 permissions 数组' });
    }

    try {
      permissionService.updatePermissions(body.permissions);
      return reply.send({ success: true, message: '权限更新成功' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply
        .status(err.statusCode || 500)
        .send({ success: false, error: err.message });
    }
  });

  app.get('/api/auth/my-permissions', async (request, reply) => {
    let payload;
    try {
      payload = await authenticate(request, reply);
    } catch {
      return;
    }

    if (payload.role === 'admin') {
      const allPermissions = permissionService.getAllPermissions();
      const visiblePages = allPermissions.map((p) => p.page_id);
      return reply.send({ success: true, data: { role: 'admin', visible_pages: visiblePages } });
    }

    const visiblePages = permissionService.getVisiblePagesForUser();
    return reply.send({ success: true, data: { role: 'user', visible_pages: visiblePages } });
  });

  app.post('/api/auth/generate-binding-code', async (request, reply) => {
    let payload;
    try {
      payload = await authenticate(request, reply);
    } catch {
      return;
    }

    const body = request.body as { player_name?: string };
    if (!body.player_name || !body.player_name.trim()) {
      return reply.status(400).send({ success: false, error: '请输入玩家名称' });
    }

    try {
      const result = service.generateBindingCode(payload.user_id, body.player_name.trim());
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

  app.post('/api/auth/unbind', async (request, reply) => {
    let payload;
    try {
      payload = await authenticate(request, reply);
    } catch {
      return;
    }

    try {
      const result = service.unbindGame(payload.user_id);
      return reply.send({ success: true, data: result });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });
}
