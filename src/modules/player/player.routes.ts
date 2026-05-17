import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as service from './player.service.js';
import { verifyToken } from '../../plugins/jwt.js';
import type { JwtPayload } from '../../plugins/jwt.js';
import {
  kickPlayerSchema,
  banPlayerSchema,
  unbanPlayerSchema,
  setAdminSchema,
  setWhitelistSchema,
} from './player.schema.js';

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

function requireAdmin(payload: JwtPayload, reply: FastifyReply): boolean {
  if (payload.role !== 'admin') {
    reply.status(403).send({ success: false, error: '权限不足' });
    return false;
  }
  return true;
}

export default async function playerRoutes(app: FastifyInstance) {
  app.get('/api/players/online', async (request, reply) => {
    const payload = authenticate(request, reply);
    if (!payload) return;

    try {
      const players = await service.getOnlinePlayers();
      return reply.send({ success: true, data: { players, count: players.length } });
    } catch (e) {
      const err = e as { message: string };
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/players/admins', async (request, reply) => {
    const payload = authenticate(request, reply);
    if (!payload) return;

    try {
      const admins = await service.getAdmins();
      return reply.send({ success: true, data: admins });
    } catch (e) {
      const err = e as { message: string };
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/players/bans', async (request, reply) => {
    const payload = authenticate(request, reply);
    if (!payload) return;
    if (!requireAdmin(payload, reply)) return;

    try {
      const bans = await service.getBans();
      return reply.send({ success: true, data: bans });
    } catch (e) {
      const err = e as { message: string };
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/players/whitelist', async (request, reply) => {
    const payload = authenticate(request, reply);
    if (!payload) return;
    if (!requireAdmin(payload, reply)) return;

    try {
      const list = await service.getWhitelist();
      return reply.send({ success: true, data: list });
    } catch (e) {
      const err = e as { message: string };
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/players/kick', async (request, reply) => {
    const payload = authenticate(request, reply);
    if (!payload) return;
    if (!requireAdmin(payload, reply)) return;

    const parsed = kickPlayerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    }

    try {
      const output = await service.kickPlayer(parsed.data.player, parsed.data.reason);
      return reply.send({ success: true, data: { output } });
    } catch (e) {
      const err = e as { message: string };
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/players/ban', async (request, reply) => {
    const payload = authenticate(request, reply);
    if (!payload) return;
    if (!requireAdmin(payload, reply)) return;

    const parsed = banPlayerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    }

    try {
      const output = await service.banPlayer(parsed.data.player, parsed.data.reason);
      return reply.send({ success: true, data: { output } });
    } catch (e) {
      const err = e as { message: string };
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/players/unban', async (request, reply) => {
    const payload = authenticate(request, reply);
    if (!payload) return;
    if (!requireAdmin(payload, reply)) return;

    const parsed = unbanPlayerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    }

    try {
      const output = await service.unbanPlayer(parsed.data.player);
      return reply.send({ success: true, data: { output } });
    } catch (e) {
      const err = e as { message: string };
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/players/set-admin', async (request, reply) => {
    const payload = authenticate(request, reply);
    if (!payload) return;
    if (!requireAdmin(payload, reply)) return;

    const parsed = setAdminSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    }

    try {
      const output = await service.setAdmin(parsed.data.player, parsed.data.admin);
      return reply.send({ success: true, data: { output } });
    } catch (e) {
      const err = e as { message: string };
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/players/set-whitelist', async (request, reply) => {
    const payload = authenticate(request, reply);
    if (!payload) return;
    if (!requireAdmin(payload, reply)) return;

    const parsed = setWhitelistSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    }

    try {
      const output = await service.setWhitelist(parsed.data.player, parsed.data.whitelist);
      return reply.send({ success: true, data: { output } });
    } catch (e) {
      const err = e as { message: string };
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/players/whisper', async (request, reply) => {
    const payload = authenticate(request, reply);
    if (!payload) return;
    if (!requireAdmin(payload, reply)) return;

    const { player, message } = (request.body as { player?: string; message?: string }) || {};
    if (!player || !message) {
      return reply.status(400).send({ success: false, error: 'player 和 message 不能为空' });
    }

    try {
      const output = await service.whisperMessage(player, message);
      return reply.send({ success: true, data: { output } });
    } catch (e) {
      const err = e as { message: string };
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/players/say', async (request, reply) => {
    const payload = authenticate(request, reply);
    if (!payload) return;
    if (!requireAdmin(payload, reply)) return;

    const { message } = (request.body as { message?: string }) || {};
    if (!message) {
      return reply.status(400).send({ success: false, error: 'message 不能为空' });
    }

    try {
      const output = await service.sayMessage(message);
      return reply.send({ success: true, data: { output } });
    } catch (e) {
      const err = e as { message: string };
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/players/give', async (request, reply) => {
    const payload = authenticate(request, reply);
    if (!payload) return;
    if (!requireAdmin(payload, reply)) return;

    const { player, item, count } = (request.body as { player?: string; item?: string; count?: number }) || {};
    if (!player || !item) {
      return reply.status(400).send({ success: false, error: 'player 和 item 不能为空' });
    }

    try {
      const output = await service.giveItem(player, item, count ?? 1);
      return reply.send({ success: true, data: { output } });
    } catch (e) {
      const err = e as { message: string };
      return reply.status(500).send({ success: false, error: err.message });
    }
  });
}
