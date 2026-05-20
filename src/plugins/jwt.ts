import jwt from 'jsonwebtoken';
import { loadEnv } from '../config/env.js';

export interface JwtPayload {
  user_id: number;
  username: string;
  role: string;
  pwd_ver: number;
}

let _env: ReturnType<typeof loadEnv> | null = null;

function getEnv(): ReturnType<typeof loadEnv> {
  if (!_env) {
    _env = loadEnv();
  }
  return _env;
}

export function signToken(payload: JwtPayload): string {
  const env = getEnv();
  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '24h',
  });
}

export function verifyToken(token: string): JwtPayload {
  const env = getEnv();
  return jwt.verify(token, env.JWT_SECRET, {
    algorithms: ['HS256'],
  }) as JwtPayload;
}

export function refreshIfNeeded(token: string, thresholdMs = 3600000): string | null {
  const env = getEnv();

  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
    }) as JwtPayload & { exp?: number; iat?: number };

    if (!payload.exp) return null;

    const remaining = payload.exp * 1000 - Date.now();
    if (remaining > thresholdMs) return null;

    return jwt.sign(
      {
        user_id: payload.user_id,
        username: payload.username,
        role: payload.role,
        pwd_ver: payload.pwd_ver,
      },
      env.JWT_SECRET,
      {
        algorithm: 'HS256',
        expiresIn: '24h',
      }
    );
  } catch {
    return null;
  }
}