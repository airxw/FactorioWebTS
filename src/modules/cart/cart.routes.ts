import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as service from './cart.service.js';
import { verifyToken } from '../../plugins/jwt.js';
import type { JwtPayload } from '../../plugins/jwt.js';
import { cartSyncSchema } from './cart.schema.js';

function authenticate(request: FastifyRequest, reply: FastifyReply): JwtPayload | null {
  const header = request.headers.authorization;
  if (!header) {
    reply.status(401).send({ success: false, error: '缺少认证令牌' });
    return null;
  }
  try {
    return verifyToken(header.replace(/^Bearer\s+/i, ''));
  } catch {
    reply.status(401).send({ success: false, error: '令牌无效或已过期' });
    return null;
  }
}

export default async function cartRoutes(app: FastifyInstance) {
  app.get('/api/cart', async (request, reply) => {
    const payload = authenticate(request, reply);
    if (!payload) return;

    const items = service.getCart(payload.user_id);
    return reply.send({ success: true, data: items });
  });

  app.put('/api/cart', async (request, reply) => {
    const payload = authenticate(request, reply);
    if (!payload) return;

    const parsed = cartSyncSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    }

    try {
      service.syncCart(payload.user_id, parsed.data.items);
      return reply.send({ success: true, message: '购物车已同步' });
    } catch (e) {
      const err = e as { message: string };
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  app.delete('/api/cart', async (request, reply) => {
    const payload = authenticate(request, reply);
    if (!payload) return;

    try {
      service.clearCart(payload.user_id);
      return reply.send({ success: true, message: '购物车已清空' });
    } catch (e) {
      const err = e as { message: string };
      return reply.status(500).send({ success: false, error: err.message });
    }
  });
}