import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from '../../plugins/jwt.js';
import type { JwtPayload } from '../../plugins/jwt.js';
import * as service from './chat.service.js';
import {
  triggerResponseSchema,
  serverResponseSchema,
  periodicMessageSchema,
  playerEventSchema,
} from './chat.schema.js';

async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<JwtPayload> {
  const authHeader = request.headers.authorization;
  if (!authHeader) { reply.status(401).send({ success: false, error: '缺少认证令牌' }); throw new Error(); }
  try { return verifyToken(authHeader.replace(/^Bearer\s+/i, '')); }
  catch { reply.status(401).send({ success: false, error: '令牌无效或已过期' }); throw new Error(); }
}

function requireAdmin(payload: JwtPayload, reply: FastifyReply): void {
  if (payload.role !== 'admin') { reply.status(403).send({ success: false, error: '权限不足，需要管理员角色' }); throw new Error(); }
}

export default async function chatRoutes(app: FastifyInstance) {
  app.get('/api/chat/settings', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const settings = service.getChatSettings();
    return reply.send({ success: true, data: settings });
  });

  app.post('/api/chat/settings', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const body = request.body as Record<string, unknown> || {};
    service.saveChatSettings(body);
    return reply.send({ success: true, message: '聊天设置已保存' });
  });

  app.get('/api/chat/trigger-responses', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    return reply.send({ success: true, data: service.listTriggerResponses() });
  });

  app.post('/api/chat/trigger-responses', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const parsed = triggerResponseSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    const id = service.addTriggerResponse(parsed.data);
    return reply.status(201).send({ success: true, data: { id } });
  });

  app.delete('/api/chat/trigger-responses/:id', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const { id } = request.params as { id: string };
    try {
      service.deleteTriggerResponse(parseInt(id, 10));
      return reply.send({ success: true, message: '删除成功' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.put('/api/chat/trigger-responses/:id', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const { id } = request.params as { id: string };
    const parsed = triggerResponseSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    try {
      service.updateTriggerResponse(parseInt(id, 10), parsed.data);
      return reply.send({ success: true, message: '更新成功' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/chat/trigger-responses/:id/toggle', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const { id } = request.params as { id: string };
    const { enabled } = (request.body || {}) as { enabled?: number };
    try {
      service.updateTriggerResponse(parseInt(id, 10), { enabled: enabled ?? 1 });
      return reply.send({ success: true, message: '状态已切换' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/chat/server-responses', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    return reply.send({ success: true, data: service.listServerResponses() });
  });

  app.post('/api/chat/server-responses', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const parsed = serverResponseSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    service.saveServerResponse(parsed.data);
    return reply.send({ success: true, message: '服务器响应已保存' });
  });

  app.delete('/api/chat/server-responses/:key', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const { key } = request.params as { key: string };
    try {
      service.deleteServerResponse(key);
      return reply.send({ success: true, message: '删除成功' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/chat/periodic-messages', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    return reply.send({ success: true, data: service.listPeriodicMessages() });
  });

  app.post('/api/chat/periodic-messages', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const parsed = periodicMessageSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    const id = service.addPeriodicMessage(parsed.data);
    return reply.status(201).send({ success: true, data: { id } });
  });

  app.put('/api/chat/periodic-messages/:id', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const { id } = request.params as { id: string };
    const parsed = periodicMessageSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    try {
      service.updatePeriodicMessage(parseInt(id, 10), parsed.data);
      return reply.send({ success: true, message: '更新成功' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.delete('/api/chat/periodic-messages/:id', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const { id } = request.params as { id: string };
    try {
      service.deletePeriodicMessage(parseInt(id, 10));
      return reply.send({ success: true, message: '删除成功' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/chat/periodic-messages/:id/toggle', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const { id } = request.params as { id: string };
    const { enabled } = (request.body || {}) as { enabled?: number };
    try {
      service.togglePeriodicMessage(parseInt(id, 10), enabled ?? 1);
      return reply.send({ success: true, message: '状态已切换' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/chat/player-events', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    return reply.send({ success: true, data: service.getPlayerEvents() });
  });

  app.post('/api/chat/player-events', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const parsed = playerEventSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    service.savePlayerEvent(parsed.data);
    return reply.send({ success: true, message: '玩家事件配置已保存' });
  });
}
