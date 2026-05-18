import type { FastifyInstance } from 'fastify';
import * as service from './server.service.js';
import { authenticate, requireAdmin } from '../../plugins/auth-guard.js';

export default async function serverRoutes(app: FastifyInstance) {
  app.get('/api/server/state', { preHandler: [authenticate] }, async (_request, reply) => {
    try {
      const stateInfo = service.getServerState();
      return reply.send({ success: true, data: stateInfo });
    } catch (e) {
      const err = e as { message: string };
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/server/status', { preHandler: [authenticate] }, async (request, reply) => {
    const status = await service.getStatus();
    return reply.send({ success: true, data: status });
  });

  app.get('/api/server/stats', { preHandler: [authenticate] }, async (request, reply) => {
    const stats = await service.getSystemStats();
    return reply.send({ success: true, data: stats });
  });

  app.post('/api/server/start', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { version, map, config } = (request.body as { version?: string; map?: string; config?: string }) || {};
    const result = await service.startServer(version, map, config);
    return reply.send({ success: true, data: result });
  });

  app.post('/api/server/stop', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const result = await service.stopServer();
    return reply.send({ success: true, data: result });
  });

  app.post('/api/server/restart', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const result = await service.restartServer();
    return reply.send({ success: true, data: result });
  });

  app.post('/api/server/save', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const result = await service.saveGame();
    return reply.send({ success: true, data: result });
  });

  app.post('/api/server/console', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { command } = (request.body as { command?: string }) || {};
    if (!command) {
      return reply.status(400).send({ success: false, error: 'command 不能为空' });
    }
    const response = await service.sendConsole(command);
    return reply.send({ success: true, data: { response } });
  });

  app.get('/api/server/is-running', { preHandler: [authenticate] }, async (_request, reply) => {
    try {
      const running = await service.isRunning();
      return reply.send({ success: true, data: { running } });
    } catch (e) {
      const err = e as { message: string };
      return reply.status(500).send({ success: false, error: err.message });
    }
  });
}