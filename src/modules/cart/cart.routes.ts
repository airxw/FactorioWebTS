import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as service from './cart.service.js';
import { authenticate } from '../../plugins/auth-guard.js';
import { cartSyncSchema } from './cart.schema.js';

export default async function cartRoutes(app: FastifyInstance) {
  app.get('/api/cart', { preHandler: [authenticate] }, async (request, reply) => {
    const items = service.getCart(request.currentUser.user_id);
    return reply.send({ success: true, data: items });
  });

  app.put('/api/cart', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = cartSyncSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    }

    try {
      service.syncCart(request.currentUser.user_id, parsed.data.items);
      return reply.send({ success: true, message: '购物车已同步' });
    } catch (e) {
      const err = e as { message: string };
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  app.delete('/api/cart', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      service.clearCart(request.currentUser.user_id);
      return reply.send({ success: true, message: '购物车已清空' });
    } catch (e) {
      const err = e as { message: string };
      return reply.status(500).send({ success: false, error: err.message });
    }
  });
}