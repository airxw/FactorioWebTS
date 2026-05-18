import type { FastifyInstance } from 'fastify';
import { authenticate, requireAdmin } from '../../plugins/auth-guard.js';
import * as service from './vote.service.js';
import {
  voteConfigSchema,
  startVoteSchema,
  castVoteSchema,
  banPlayerSchema,
} from './vote.schema.js';

export default async function voteRoutes(app: FastifyInstance) {
  app.get('/api/vote/config', async (_request, reply) => {
    return reply.send({ success: true, data: service.getVoteConfig() });
  });

  app.post('/api/vote/config', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = voteConfigSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    service.updateVoteConfig(parsed.data);
    return reply.send({ success: true, message: 'Vote config updated' });
  });

  app.post('/api/vote/start', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = startVoteSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    try {
      const voteId = await service.startVote(parsed.data, request.currentUser.user_id);
      return reply.status(201).send({ success: true, data: { vote_id: voteId } });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/vote/cast', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = castVoteSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    try {
      service.castVote(parsed.data, request.currentUser.user_id);
      return reply.send({ success: true, message: 'Vote recorded' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/vote/list', { preHandler: [authenticate] }, async (request, reply) => {
    const { status, limit, offset } = request.query as { status?: string; limit?: string; offset?: string };
    const data = service.getVotes({
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return reply.send({ success: true, data });
  });

  app.get('/api/vote/active', { preHandler: [authenticate] }, async (_request, reply) => {
    return reply.send({ success: true, data: service.getActiveVotes() });
  });

  app.get('/api/vote/detail/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const detail = service.getVoteDetail(parseInt(id, 10));
      return reply.send({ success: true, data: detail });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/vote/check-result/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    service.checkAndResolveVote(parseInt(id, 10));
    try {
      const detail = service.getVoteDetail(parseInt(id, 10));
      return reply.send({ success: true, data: detail });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/vote/has-voted/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const voted = service.hasVoted(parseInt(id, 10), request.currentUser.user_id);
    return reply.send({ success: true, data: { has_voted: voted } });
  });

  app.post('/api/vote/cancel', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { vote_id } = (request.body || {}) as { vote_id?: number };
    if (!vote_id) return reply.status(400).send({ success: false, error: 'vote_id is required' });
    try {
      service.cancelVote(vote_id);
      return reply.send({ success: true, message: 'Vote cancelled' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/vote/ban', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = banPlayerSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    try {
      await service.banPlayer(parsed.data);
      return reply.send({ success: true, message: 'Player banned' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/vote/process-expired', { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    const count = service.processExpiredVotes();
    return reply.send({ success: true, message: `Processed ${count} expired votes` });
  });
}