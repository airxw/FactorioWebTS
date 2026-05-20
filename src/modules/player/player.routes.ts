import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as service from './player.service.js';
import { authenticate, requireAdmin } from '../../plugins/auth-guard.js';
import {
  kickPlayerSchema,
  banPlayerSchema,
  unbanPlayerSchema,
  setAdminSchema,
  setWhitelistSchema,
} from './player.schema.js';

export default async function playerRoutes(app: FastifyInstance) {
  app.get('/api/players/online', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const players = await service.getOnlinePlayers();
      return reply.send({ success: true, data: { players, count: players.length } });
    } catch (e) {
      const err = e as { message: string };
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/players/admins', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const admins = await service.getAdmins();
      return reply.send({ success: true, data: admins });
    } catch (e) {
      const err = e as { message: string };
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/players/bans', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    try {
      const bans = await service.getBans();
      return reply.send({ success: true, data: bans });
    } catch (e) {
      const err = e as { message: string };
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/players/whitelist', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    try {
      const list = await service.getWhitelist();
      return reply.send({ success: true, data: list });
    } catch (e) {
      const err = e as { message: string };
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/players/kick', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
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

  app.post('/api/players/ban', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
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

  app.post('/api/players/unban', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
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

  app.post('/api/players/set-admin', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
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

  app.post('/api/players/set-whitelist', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
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

  app.post('/api/players/whisper', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
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

  app.post('/api/players/say', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
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

  app.post('/api/players/give', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
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