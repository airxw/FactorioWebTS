import type { FastifyInstance } from 'fastify';
import { authenticate, requireAdmin } from '../../plugins/auth-guard.js';
import * as service from './backup.service.js';

export default async function backupRoutes(app: FastifyInstance) {
  app.post('/api/backup', { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    try {
      const info = service.createBackup();
      return reply.send({ success: true, data: info });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/backup/list', { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    const backups = service.listBackups();
    return reply.send({ success: true, data: backups });
  });

  app.post('/api/backup/restore/:filename', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { filename } = request.params as { filename: string };
    try {
      service.restoreBackup(filename);
      return reply.send({ success: true, message: '数据库已恢复' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.delete('/api/backup/:filename', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { filename } = request.params as { filename: string };
    try {
      service.deleteBackup(filename);
      return reply.send({ success: true, message: '备份已删除' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });
}
