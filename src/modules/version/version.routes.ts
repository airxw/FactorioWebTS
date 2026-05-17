import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from '../../plugins/jwt.js';
import type { JwtPayload } from '../../plugins/jwt.js';
import * as service from './version.service.js';
import { versionUpgradeSchema } from './version.schema.js';

async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<JwtPayload> {
  const authHeader = request.headers.authorization;
  if (!authHeader) { reply.status(401).send({ success: false, error: '缺少认证令牌' }); throw new Error(); }
  try { return verifyToken(authHeader.replace(/^Bearer\s+/i, '')); }
  catch { reply.status(401).send({ success: false, error: '令牌无效或已过期' }); throw new Error(); }
}

function requireAdmin(payload: JwtPayload, reply: FastifyReply): void {
  if (payload.role !== 'admin') { reply.status(403).send({ success: false, error: '权限不足，需要管理员角色' }); throw new Error(); }
}

export default async function versionRoutes(app: FastifyInstance) {
  app.get('/api/versions', async (request, reply) => {
    let _p; try { _p = await authenticate(request, reply); } catch { return; }
    return reply.send({ success: true, data: service.listAllVersions() });
  });

  app.get('/api/versions/current', async (request, reply) => {
    let _p; try { _p = await authenticate(request, reply); } catch { return; }
    return reply.send({ success: true, data: service.getCurrentVersion() });
  });

  app.get('/api/versions/latest', async (request, reply) => {
    let _p; try { _p = await authenticate(request, reply); } catch { return; }
    const { release_type } = request.query as { release_type?: string };
    const data = await service.getLatestVersion(release_type || 'stable');
    return reply.send({ success: true, data });
  });

  app.get('/api/versions/latest-all', async (request, reply) => {
    let _p; try { _p = await authenticate(request, reply); } catch { return; }
    const data = await service.getAllLatestVersions();
    return reply.send({ success: true, data });
  });

  app.post('/api/versions/upgrade', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const parsed = versionUpgradeSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    try {
      service.installVersion(parsed.data.target_version, parsed.data.release_type);
      return reply.send({ success: true, message: '版本安装中' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/versions/set-default', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
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

  app.delete('/api/versions/:version', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const { version } = request.params as { version: string };
    try {
      service.deleteVersionData(version);
      return reply.send({ success: true, message: '版本已删除' });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/versions/verify/:version', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const { version } = request.params as { version: string };
    const result = service.verifyVersion(version);
    return reply.send({ success: true, data: result });
  });

  app.get('/api/versions/progress', async (request, reply) => {
    let p; try { p = await authenticate(request, reply); } catch { return; }
    try { requireAdmin(p, reply); } catch { return; }
    const { version } = request.query as { version?: string };
    const data = service.getInstallProgress(version || '');
    return reply.send({ success: true, data });
  });
}
