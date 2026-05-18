import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireAdmin } from '../../plugins/auth-guard.js';
import * as service from './config.service.js';
import { configTemplateSchema } from './config.schema.js';

export default async function configRoutes(app: FastifyInstance) {
  app.get('/api/config/files', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    return reply.send({ success: true, data: { files: service.getConfigFiles() } });
  });

  app.get('/api/config/get', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { file_type } = request.query as { file_type?: string };
    if (!file_type) return reply.status(400).send({ success: false, error: 'file_type 是必填参数' });
    try {
      const data = service.getConfigFile(file_type);
      return reply.send({ success: true, data });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/config/save', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { file_type, content } = (request.body || {}) as { file_type?: string; content?: string };
    if (!file_type) return reply.status(400).send({ success: false, error: 'file_type 是必填项' });
    if (content === undefined) return reply.status(400).send({ success: false, error: 'content 是必填项' });
    try {
      service.saveConfigFile(file_type, content);
      return reply.send({ success: true, message: '配置已保存' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/config/validate', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { file_type, content } = (request.body || {}) as { file_type?: string; content?: string };
    if (!file_type) return reply.status(400).send({ success: false, error: 'file_type 是必填项' });
    if (content === undefined) return reply.status(400).send({ success: false, error: 'content 是必填项' });
    const result = service.validateConfig(file_type, content);
    return reply.send({ success: true, data: result });
  });

  app.get('/api/config/templates', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const templates = service.listTemplates();
    return reply.send({ success: true, data: { templates } });
  });

  app.get('/api/config/templates/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const tpl = service.getTemplate(parseInt(id, 10));
      return reply.send({ success: true, data: tpl });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/config/templates', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = configTemplateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    const id = service.createTemplate(parsed.data);
    return reply.status(201).send({ success: true, data: { id } });
  });

  app.delete('/api/config/templates/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      service.deleteTemplate(parseInt(id, 10));
      return reply.send({ success: true, message: '模板已删除' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/config/templates/:id/apply', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      service.applyTemplate(parseInt(id, 10));
      return reply.send({ success: true, message: '模板已应用' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/config/backups/:fileType', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { fileType } = request.params as { fileType?: string };
    if (!fileType) return reply.status(400).send({ success: false, error: 'fileType 是必填参数' });
    try {
      const backups = service.listBackups(fileType);
      return reply.send({ success: true, data: { backups } });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/config/backups/:fileType/restore', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { fileType } = request.params as { fileType?: string };
    const { timestamp } = (request.body || {}) as { timestamp?: string };
    if (!fileType) return reply.status(400).send({ success: false, error: 'fileType 是必填参数' });
    if (!timestamp) return reply.status(400).send({ success: false, error: 'timestamp 是必填参数' });
    try {
      service.restoreBackup(fileType, timestamp);
      return reply.send({ success: true, message: '配置已从备份恢复' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.delete('/api/config/backups/:fileType/cleanup', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { fileType } = request.params as { fileType?: string };
    const { keep_count } = request.query as { keep_count?: string };
    if (!fileType) return reply.status(400).send({ success: false, error: 'fileType 是必填参数' });
    try {
      const keepCount = keep_count ? parseInt(keep_count, 10) : 10;
      const deleted = service.cleanupBackups(fileType, keepCount);
      return reply.send({ success: true, data: { deleted }, message: `已清理 ${deleted} 个旧备份` });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });
}