import type { FastifyInstance } from 'fastify';
import { authenticate, requireAdmin } from '../../plugins/auth-guard.js';
import * as service from './chat.service.js';
import {
  triggerResponseSchema,
  serverResponseSchema,
  periodicMessageSchema,
  playerEventSchema,
} from './chat.schema.js';

export default async function chatRoutes(app: FastifyInstance) {
  app.get('/api/chat/settings', { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    const settings = service.getChatSettings();
    return reply.send({ success: true, data: settings });
  });

  app.post('/api/chat/settings', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const body = request.body as Record<string, unknown> || {};
    service.saveChatSettings(body);
    return reply.send({ success: true, message: 'Chat settings saved' });
  });

  app.get('/api/chat/trigger-responses', { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    return reply.send({ success: true, data: service.listTriggerResponses() });
  });

  app.post('/api/chat/trigger-responses', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = triggerResponseSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    const id = service.addTriggerResponse(parsed.data);
    return reply.status(201).send({ success: true, data: { id } });
  });

  app.delete('/api/chat/trigger-responses/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      service.deleteTriggerResponse(parseInt(id, 10));
      return reply.send({ success: true, message: 'Deleted' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.put('/api/chat/trigger-responses/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = triggerResponseSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    try {
      service.updateTriggerResponse(parseInt(id, 10), parsed.data);
      return reply.send({ success: true, message: 'Updated' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/chat/trigger-responses/:id/toggle', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { enabled } = (request.body || {}) as { enabled?: number };
    try {
      service.updateTriggerResponse(parseInt(id, 10), { enabled: enabled ?? 1 });
      return reply.send({ success: true, message: 'Status toggled' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/chat/server-responses', { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    return reply.send({ success: true, data: service.listServerResponses() });
  });

  app.post('/api/chat/server-responses', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = serverResponseSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    service.saveServerResponse(parsed.data);
    return reply.send({ success: true, message: 'Server response saved' });
  });

  app.delete('/api/chat/server-responses/:key', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { key } = request.params as { key: string };
    try {
      service.deleteServerResponse(key);
      return reply.send({ success: true, message: 'Deleted' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/chat/periodic-messages', { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    return reply.send({ success: true, data: service.listPeriodicMessages() });
  });

  app.post('/api/chat/periodic-messages', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = periodicMessageSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    const id = service.addPeriodicMessage(parsed.data);
    return reply.status(201).send({ success: true, data: { id } });
  });

  app.put('/api/chat/periodic-messages/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = periodicMessageSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    try {
      service.updatePeriodicMessage(parseInt(id, 10), parsed.data);
      return reply.send({ success: true, message: 'Updated' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.delete('/api/chat/periodic-messages/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      service.deletePeriodicMessage(parseInt(id, 10));
      return reply.send({ success: true, message: 'Deleted' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/chat/periodic-messages/:id/toggle', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { enabled } = (request.body || {}) as { enabled?: number };
    try {
      service.togglePeriodicMessage(parseInt(id, 10), enabled ?? 1);
      return reply.send({ success: true, message: 'Status toggled' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/chat/player-events', { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    return reply.send({ success: true, data: service.getPlayerEvents() });
  });

  app.post('/api/chat/player-events', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = playerEventSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    service.savePlayerEvent(parsed.data);
    return reply.send({ success: true, message: 'Player event config saved' });
  });

  app.get('/api/chat/first-join-players', { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    return reply.send({ success: true, data: service.listFirstJoinPlayers() });
  });

  app.delete('/api/chat/first-join-players/:playerName', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { playerName } = request.params as { playerName: string };
    try {
      const result = service.resetFirstJoinPlayer(playerName);
      return reply.send({ success: true, data: result, message: '已重置首次登陆状态' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });
}