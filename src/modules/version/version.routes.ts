import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireAdmin } from '../../plugins/auth-guard.js';
import * as service from './version.service.js';
import { versionUpgradeSchema } from './version.schema.js';
import { logger } from '../../lib/logger.js';

export default async function versionRoutes(app: FastifyInstance) {
  app.get('/api/versions', { preHandler: [authenticate] }, async (request, reply) => {
    return reply.send({ success: true, data: service.listAllVersions() });
  });

  app.get('/api/versions/current', { preHandler: [authenticate] }, async (request, reply) => {
    return reply.send({ success: true, data: service.getCurrentVersion() });
  });

  app.get('/api/versions/latest', { preHandler: [authenticate] }, async (request, reply) => {
    const { release_type } = request.query as { release_type?: string };
    const data = await service.getLatestVersion(release_type || 'stable');
    return reply.send({ success: true, data });
  });

  app.get('/api/versions/latest-all', { preHandler: [authenticate] }, async (request, reply) => {
    const data = await service.getAllLatestVersions();
    return reply.send({ success: true, data });
  });

  app.post('/api/versions/upgrade', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = versionUpgradeSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });

    const { target_version, release_type } = parsed.data;
    const currentProgress = service.getInstallProgress(target_version);
    if (currentProgress.progress > 0 && currentProgress.progress < 100) {
      return reply.status(409).send({ success: false, error: '该版本正在安装中' });
    }

    service.installVersion(target_version, release_type).catch((e: unknown) => {
      const err = e as { statusCode?: number; message: string };
      logger.error({ err: e, version: target_version }, '[Version] Background install failed');
    });

    return reply.send({ success: true, message: '版本安装已启动' });
  });

  app.post('/api/versions/set-default', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { version } = (request.body || {}) as { version?: string };
    if (!version) return reply.status(400).send({ success: false, error: 'version 是必填项' });
    try {
      service.setDefaultVersion(version);
      return reply.send({ success: true, message: '默认版本已设置' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.delete('/api/versions/:version', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { version } = request.params as { version: string };
    try {
      service.deleteVersionData(version);
      return reply.send({ success: true, message: '版本已删除' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/versions/verify/:version', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { version } = request.params as { version: string };
    const result = service.verifyVersion(version);
    return reply.send({ success: true, data: result });
  });

  app.get('/api/versions/progress', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { version } = request.query as { version?: string };
    const data = service.getInstallProgress(version || '');
    return reply.send({ success: true, data });
  });
}