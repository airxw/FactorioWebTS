import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from '../../plugins/jwt.js';
import type { JwtPayload } from '../../plugins/jwt.js';
import * as service from './vote.service.js';
import {
  voteConfigSchema,
  startVoteSchema,
  castVoteSchema,
  banPlayerSchema,
} from './vote.schema.js';

async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<JwtPayload> {
  const authHeader = request.headers.authorization;
  if (!authHeader) { reply.status(401).send({ success: false, error: '缺少认证令牌' }); throw new Error(); }
  try { return verifyToken(authHeader.replace(/^Bearer\s+/i, '')); }
  catch { reply.status(401).send({ success: false, error: '令牌无效或已过期' }); throw new Error(); }
}

function requireAdmin(payload: JwtPayload, reply: FastifyReply): void {
  if (payload.role !== 'admin') { reply.status(403).send({ success: false, error: '权限不足，需要管理员角色' }); throw new Error(); }
}

export default async function voteRoutes(app: FastifyInstance) {
  app.get('/api/vote/config', async (request, reply) => {
    return reply.send({ success: true, data: service.getVoteConfig() });
  });

  app.post('/api/vote/config', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const parsed = voteConfigSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    service.updateVoteConfig(parsed.data);
    return reply.send({ success: true, message: '投票配置已更新' });
  });

  app.post('/api/vote/start', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    const parsed = startVoteSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    try {
      const voteId = await service.startVote(parsed.data, p.user_id);
      return reply.status(201).send({ success: true, data: { vote_id: voteId } });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/vote/cast', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    const parsed = castVoteSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    try {
      service.castVote(parsed.data, p.user_id);
      return reply.send({ success: true, message: '投票已记录' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/vote/list', async (request, reply) => {
    let _p; try { _p = await authenticate(request, reply); } catch { return; }
    const { status, limit, offset } = request.query as { status?: string; limit?: string; offset?: string };
    const data = service.getVotes({
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return reply.send({ success: true, data });
  });

  app.get('/api/vote/active', async (request, reply) => {
    let _p; try { _p = await authenticate(request, reply); } catch { return; }
    return reply.send({ success: true, data: service.getActiveVotes() });
  });

  app.get('/api/vote/detail/:id', async (request, reply) => {
    let _p; try { _p = await authenticate(request, reply); } catch { return; }
    const { id } = request.params as { id: string };
    try {
      const detail = service.getVoteDetail(parseInt(id, 10));
      return reply.send({ success: true, data: detail });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/vote/check-result/:id', async (request, reply) => {
    let _p; try { _p = await authenticate(request, reply); } catch { return; }
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

  app.get('/api/vote/has-voted/:id', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    const { id } = request.params as { id: string };
    const voted = service.hasVoted(parseInt(id, 10), p.user_id);
    return reply.send({ success: true, data: { has_voted: voted } });
  });

  app.post('/api/vote/cancel', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const { vote_id } = (request.body || {}) as { vote_id?: number };
    if (!vote_id) return reply.status(400).send({ success: false, error: 'vote_id 是必填项' });
    try {
      service.cancelVote(vote_id);
      return reply.send({ success: true, message: '投票已取消' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/vote/ban', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const parsed = banPlayerSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    try {
      service.banPlayer(parsed.data);
      return reply.send({ success: true, message: '玩家已封禁' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/vote/process-expired', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const count = service.processExpiredVotes();
    return reply.send({ success: true, message: `已处理 ${count} 个过期投票` });
  });
}
