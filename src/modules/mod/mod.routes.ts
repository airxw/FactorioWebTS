import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireAdmin } from '../../plugins/auth-guard.js';
import * as service from './mod.service.js';
import {
  modToggleSchema,
  modUninstallSchema,
  modCheckConflictsSchema,
  modInstallFromPortalSchema,
} from './mod.schema.js';

export default async function modRoutes(app: FastifyInstance) {
  app.get('/api/mod/list', { preHandler: [authenticate] }, async (request, reply) => {
    return reply.send({ success: true, data: service.listInstalledMods() });
  });

  app.post('/api/mod/toggle', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = modToggleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: parsed.error.errors[0]?.message || '参数验证失败',
        details: parsed.error.errors,
      });
    }
    try {
      service.toggleMod(parsed.data.mod_id, parsed.data.enabled);
      return reply.send({ success: true, message: '模组状态已切换' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/mod/uninstall', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = modUninstallSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: parsed.error.errors[0]?.message || '参数验证失败',
        details: parsed.error.errors,
      });
    }
    try {
      service.uninstallMod(parsed.data.mod_id);
      return reply.send({ success: true, message: '模组已卸载' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/mod/dependencies/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const deps = service.getModDependencies(parseInt(id, 10));
      return reply.send({ success: true, data: deps });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/mod/check-conflicts', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = modCheckConflictsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: parsed.error.errors[0]?.message || '参数验证失败',
        details: parsed.error.errors,
      });
    }
    const conflicts = service.checkConflicts(parsed.data.mod_ids);
    return reply.send({ success: true, data: { conflicts } });
  });

  app.get('/api/mod/check-updates', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const result = await service.checkForUpdates();
    return reply.send({ success: true, data: result });
  });

  app.post('/api/mod/sync', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const result = service.syncFromFilesystem();
    return reply.send({ success: true, data: result });
  });

  app.get('/api/mod/portal/search', { preHandler: [authenticate] }, async (request, reply) => {
    const { query, page, page_size, sort, order } = (request.query || {}) as {
      query?: string;
      page?: string;
      page_size?: string;
      sort?: 'top' | 'new' | 'updated';
      order?: 'asc' | 'desc';
    };

    if (!query) {
      return reply.status(400).send({
        success: false,
        error: '搜索关键词不能为空',
      });
    }

    try {
      const result = await service.searchModsFromPortal(
        query,
        page ? parseInt(page, 10) : 1,
        page_size ? parseInt(page_size, 10) : 10,
        sort || 'top',
        order || 'desc'
      );
      return reply.send({ success: true, data: result });
    } catch (e: unknown) {
      const err = e as { message: string; statusCode?: number };
      return reply.status(err.statusCode || 500).send({
        success: false,
        error: err.message || '搜索失败',
      });
    }
  });

  app.get('/api/mod/portal/:name', { preHandler: [authenticate] }, async (request, reply) => {
    const { name } = request.params as { name: string };

    try {
      const mod = await service.getModDetailsFromPortal(name);
      if (!mod) {
        return reply.status(404).send({
          success: false,
          error: `模组 "${name}" 不存在`,
        });
      }
      return reply.send({ success: true, data: mod });
    } catch (e: unknown) {
      const err = e as { message: string; statusCode?: number };
      return reply.status(err.statusCode || 500).send({
        success: false,
        error: err.message || '获取详情失败',
      });
    }
  });

  app.post('/api/mod/portal/install', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = modInstallFromPortalSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: parsed.error.errors[0]?.message || '参数验证失败',
        details: parsed.error.errors,
      });
    }

    try {
      const result = await service.installModFromPortal(
        parsed.data.mod_name,
        parsed.data.version
      );
      return reply.send(result);
    } catch (e: unknown) {
      const err = e as { message: string; statusCode?: number };
      return reply.status(err.statusCode || 500).send({
        success: false,
        error: err.message || '安装失败',
      });
    }
  });
}