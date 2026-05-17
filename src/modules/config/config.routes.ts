import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from '../../plugins/jwt.js';
import type { JwtPayload } from '../../plugins/jwt.js';
import * as service from './config.service.js';
import { configTemplateSchema } from './config.schema.js';

async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<JwtPayload> {
  const authHeader = request.headers.authorization;
  if (!authHeader) { reply.status(401).send({ success: false, error: '缺少认证令牌' }); throw new Error(); }
  try { return verifyToken(authHeader.replace(/^Bearer\s+/i, '')); }
  catch { reply.status(401).send({ success: false, error: '令牌无效或已过期' }); throw new Error(); }
}

function requireAdmin(payload: JwtPayload, reply: FastifyReply): void {
  if (payload.role !== 'admin') { reply.status(403).send({ success: false, error: '权限不足，需要管理员角色' }); throw new Error(); }
}

export default async function configRoutes(app: FastifyInstance) {
  app.get('/api/config/files', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    return reply.send({ success: true, data: { files: service.getConfigFiles() } });
  });

  app.get('/api/config/get', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
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

  app.post('/api/config/save', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
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

  app.post('/api/config/validate', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const { file_type, content } = (request.body || {}) as { file_type?: string; content?: string };
    if (!file_type) return reply.status(400).send({ success: false, error: 'file_type 是必填项' });
    if (content === undefined) return reply.status(400).send({ success: false, error: 'content 是必填项' });
    const result = service.validateConfig(file_type, content);
    return reply.send({ success: true, data: result });
  });

  app.get('/api/config/templates', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const templates = service.listTemplates();
    return reply.send({ success: true, data: { templates } });
  });

  app.get('/api/config/templates/:id', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const { id } = request.params as { id: string };
    try {
      const tpl = service.getTemplate(parseInt(id, 10));
      return reply.send({ success: true, data: tpl });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/config/templates', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const parsed = configTemplateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    const id = service.createTemplate(parsed.data);
    return reply.status(201).send({ success: true, data: { id } });
  });

  app.delete('/api/config/templates/:id', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const { id } = request.params as { id: string };
    try {
      service.deleteTemplate(parseInt(id, 10));
      return reply.send({ success: true, message: '模板已删除' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/config/templates/:id/apply', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const { id } = request.params as { id: string };
    try {
      service.applyTemplate(parseInt(id, 10));
      return reply.send({ success: true, message: '模板已应用' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/config/backups/:fileType', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
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

  app.post('/api/config/backups/:fileType/restore', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
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

  app.delete('/api/config/backups/:fileType/cleanup', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
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
