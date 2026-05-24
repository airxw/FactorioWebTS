import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as service from './vip.service.js';
import { authenticate, requireAdmin } from '../../plugins/auth-guard.js';
import {
  createVipLevelSchema,
  updateVipLevelSchema,
  setUserVipSchema,
} from './vip.schema.js';
import { AppError } from '../../types/index.js';

interface VipMessageObj {
  join_message: string;
  leave_message: string;
  first_join_message: string;
}

interface ParsedFeatures {
  features: string[];
  messages: VipMessageObj;
}

function parseFeatures(featuresJson: string): ParsedFeatures {
  const result: ParsedFeatures = { features: [], messages: { join_message: '', leave_message: '', first_join_message: '' } };
  try {
    const parsed: unknown = JSON.parse(featuresJson);
    if (Array.isArray(parsed)) {
      result.features = parsed.filter((f): f is string => typeof f === 'string');
      for (const item of parsed) {
        if (typeof item === 'object' && item !== null) {
          const obj = item as Record<string, unknown>;
          if (obj.join_message !== undefined || obj.leave_message !== undefined || obj.first_join_message !== undefined) {
            result.messages = {
              join_message: (obj.join_message as string) || '',
              leave_message: (obj.leave_message as string) || '',
              first_join_message: (obj.first_join_message as string) || '',
            };
            break;
          }
        }
      }
    }
  } catch { /* ignore parse error */ }
  return result;
}

function buildFeaturesJson(features: string[], messages: Partial<VipMessageObj>): string {
  const items: unknown[] = [...features];
  if (messages.join_message || messages.leave_message || messages.first_join_message) {
    items.push({
      join_message: messages.join_message || '',
      leave_message: messages.leave_message || '',
      first_join_message: messages.first_join_message || '',
    });
  }
  return JSON.stringify(items);
}

export default async function vipRoutes(app: FastifyInstance) {
  app.get('/api/vip/levels', async (_request, reply) => {
    const levels = service.getLevels(true).map((l) => {
      const { features, messages } = parseFeatures(l.features_json);
      return {
        ...l,
        features,
        join_message: messages.join_message,
        leave_message: messages.leave_message,
        first_join_message: messages.first_join_message,
      };
    });
    return reply.send({ success: true, data: levels });
  });

  app.get('/api/vip/levels/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const level = service.getLevelById(parseInt(id, 10));
    if (!level) return reply.status(404).send({ success: false, error: 'VIP等级不存在' });
    const { features, messages } = parseFeatures(level.features_json);
    return reply.send({
      success: true,
      data: {
        ...level,
        features,
        join_message: messages.join_message,
        leave_message: messages.leave_message,
        first_join_message: messages.first_join_message,
      },
    });
  });

  app.post('/api/vip/levels', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const { join_message, leave_message, first_join_message, ...rest } = body || {};
    const parsed = createVipLevelSchema.safeParse(rest);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    }

    try {
      const featuresJson = buildFeaturesJson(parsed.data.features, {
        join_message: (join_message as string) || '',
        leave_message: (leave_message as string) || '',
        first_join_message: (first_join_message as string) || '',
      });
      const featuresArray: unknown[] = JSON.parse(featuresJson);
      const level = service.createLevel({ ...parsed.data, features: featuresArray as string[] });
      const { features, messages } = parseFeatures(level.features_json);
      return reply.status(201).send({
        success: true,
        data: { ...level, features, join_message: messages.join_message, leave_message: messages.leave_message, first_join_message: messages.first_join_message },
      });
    } catch (e) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.put('/api/vip/levels/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const { join_message, leave_message, first_join_message, ...rest } = body || {};
    const parsed = updateVipLevelSchema.safeParse(rest);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    }

    try {
      const existing = service.getLevelById(parseInt(id, 10));
      if (!existing) throw new AppError('VIP等级不存在', 404);
      const existingParsed = parseFeatures(existing.features_json);

      const newFeatures = parsed.data.features !== undefined ? parsed.data.features : existingParsed.features;
      const jm = join_message !== undefined ? (join_message as string) : existingParsed.messages.join_message;
      const lm = leave_message !== undefined ? (leave_message as string) : existingParsed.messages.leave_message;
      const fjm = first_join_message !== undefined ? (first_join_message as string) : existingParsed.messages.first_join_message;

      const updateData: Record<string, unknown> = { ...parsed.data };
      updateData.features_json = buildFeaturesJson(newFeatures, { join_message: jm, leave_message: lm, first_join_message: fjm });
      delete updateData.features;

      const level = service.updateLevel(parseInt(id, 10), updateData);
      const { features, messages } = parseFeatures(level.features_json);
      return reply.send({
        success: true,
        data: { ...level, features, join_message: messages.join_message, leave_message: messages.leave_message, first_join_message: messages.first_join_message },
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
