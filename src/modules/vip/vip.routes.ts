import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as service from './vip.service.js';
import { authenticate, requireAdmin } from '../../plugins/auth-guard.js';
import {
  createVipLevelSchema,
  updateVipLevelSchema,
  setUserVipSchema,
} from './vip.schema.js';

export default async function vipRoutes(app: FastifyInstance) {
  app.get('/api/vip/levels', async (_request, reply) => {
    const levels = service.getLevels(true).map((l) => ({
      ...l,
      features: JSON.parse(l.features_json),
    }));
    return reply.send({ success: true, data: levels });
  });

  app.get('/api/vip/levels/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const level = service.getLevelById(parseInt(id, 10));
    if (!level) return reply.status(404).send({ success: false, error: 'VIP等级不存在' });
    return reply.send({
      success: true,
      data: { ...level, features: JSON.parse(level.features_json) },
    });
  });

  app.post('/api/vip/levels', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = createVipLevelSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    }

    try {
      const level = service.createLevel(parsed.data);
      return reply.status(201).send({
        success: true,
        data: { ...level, features: JSON.parse(level.features_json) },
      });
    } catch (e) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.put('/api/vip/levels/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateVipLevelSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    }

    try {
      const level = service.updateLevel(parseInt(id, 10), parsed.data);
      return reply.send({
        success: true,
        data: { ...level, features: JSON.parse(level.features_json) },
      });
    } catch (e) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.delete('/api/vip/levels/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      service.deleteLevel(parseInt(id, 10));
      return reply.send({ success: true, message: '删除成功' });
    } catch (e) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/vip/set', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = setUserVipSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    }

    try {
      const result = service.setUserVip(parsed.data);
      return reply.send({ success: true, data: result });
    } catch (e) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/vip/users', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const users = service.getVipUsers();
    return reply.send({ success: true, data: users });
  });
}