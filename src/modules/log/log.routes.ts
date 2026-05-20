import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireAdmin } from '../../plugins/auth-guard.js';
import * as service from './log.service.js';
import { createReadStream } from 'node:fs';

export default async function logRoutes(app: FastifyInstance) {
  app.get('/api/logs/tail', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { lines } = request.query as { lines?: string };
    const count = Math.min(parseInt(lines || '100', 10), 1000);
    const result = service.tailLog(count);
    return reply.send({ success: true, data: result });
  });

  app.get('/api/logs', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { page, page_size, level, search, start_date, end_date, type } = request.query as Record<string, string>;
    const result = service.getLogHistory({
      page: page ? parseInt(page, 10) : undefined,
      page_size: page_size ? parseInt(page_size, 10) : undefined,
      level,
      search,
      start_date,
      end_date,
      type,
    });
    return reply.send({ success: true, data: result });
  });

  app.get('/api/logs/files', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    return reply.send({ success: true, data: service.listLogFiles() });
  });

  app.get('/api/logs/download/:filename', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { filename } = request.params as { filename: string };
    try {
      const filePath = service.getLogDownloadPath(filename);
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Content-Type', 'text/plain');
      return reply.send(createReadStream(filePath));
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.delete('/api/logs/:filename', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { filename } = request.params as { filename: string };
    try {
      service.deleteLogFile(filename);
      return reply.send({ success: true, message: '日志文件已删除' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/logs/clear', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const body = request.body as { type: string; value: number; categories: string[] };
    try {
      const result = service.clearLogs({
        type: body.type as 'time' | 'count',
        value: body.value,
        categories: body.categories || [],
      });
      return reply.send({ success: true, data: result });
    } catch (e: unknown) {
      const err = e as { message: string };
      return reply.status(500).send({ success: false, error: err.message });
    }
  });
}