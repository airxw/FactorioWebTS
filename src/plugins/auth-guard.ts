import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from './jwt.js';
import type { JwtPayload } from './jwt.js';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: JwtPayload;
  }
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader) {
    reply.status(401).send({ success: false, error: '缺少认证令牌' });
    return;
  }

  const token = authHeader.replace(/^Bearer\s+/i, '');

  try {
    request.currentUser = verifyToken(token);
  } catch {
    reply.status(401).send({ success: false, error: '令牌无效或已过期' });
    return;
  }
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (request.currentUser.role !== 'admin') {
    reply.status(403).send({ success: false, error: '权限不足，需要管理员角色' });
    return;
  }
}

export function extractOptionalUser(
  request: FastifyRequest
): JwtPayload | null {
  const header = request.headers.authorization || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!token) return null;

  try {
    return verifyToken(token);
  } catch {
    return null;
  }
}