import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireAdmin } from '../../plugins/auth-guard.js';
import * as service from './file.service.js';
import { createSaveSchema } from './file.schema.js';
import { createReadStream } from 'node:fs';

export default async function fileRoutes(app: FastifyInstance) {
  app.get('/api/files/saves', { preHandler: [authenticate] }, async (request, reply) => {
    return reply.send({ success: true, data: service.listSaves() });
  });

  app.post('/api/files/upload', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { filename, content } = (request.body || {}) as { filename?: string; content?: string };
    if (!filename || !content) return reply.status(400).send({ success: false, error: 'filename 和 content 是必填项' });
    try {
      const buffer = Buffer.from(content, 'base64');
      service.uploadSave(buffer, filename);
      return reply.send({ success: true, message: '存档上传成功' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/files/download/:filename', { preHandler: [authenticate] }, async (request, reply) => {
    const { filename } = request.params as { filename: string };
    try {
      const filePath = service.getSaveDownloadPath(filename);
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Content-Type', 'application/zip');
      return reply.send(createReadStream(filePath));
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.delete('/api/files/:filename', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { filename } = request.params as { filename: string };
    try {
      service.deleteSave(filename);
      return reply.send({ success: true, message: '存档已删除' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/files/set-current', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { filename } = (request.body || {}) as { filename?: string };
    if (!filename) return reply.status(400).send({ success: false, error: 'filename 是必填项' });
    try {
      service.setCurrentSave(filename);
      return reply.send({ success: true, message: '当前存档已设置' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/files/create-save', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = createSaveSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    try {
      const result = await service.createSave(parsed.data);
      return reply.send({ success: true, data: result });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });
}