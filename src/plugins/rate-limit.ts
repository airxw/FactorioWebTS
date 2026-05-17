import type { FastifyInstance, FastifyRequest } from 'fastify';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const stores = {
  strict: new Map<string, RateLimitEntry>(),
  default: new Map<string, RateLimitEntry>(),
};

const LIMITS = {
  strict: { max: 10, windowMs: 60_000 },
  default: { max: 100, windowMs: 60_000 },
};

const STRICT_PATHS = new Set<string>([
  '/api/auth/login',
  '/api/auth/register',
]);

function getClientIP(request: FastifyRequest): string {
  return request.ip;
}

function cleanupExpired(): void {
  const now = Date.now();
  for (const store of Object.values(stores)) {
    for (const [key, entry] of store) {
      if (now >= entry.resetTime) {
        store.delete(key);
      }
    }
  }
}

export function registerRateLimit(app: FastifyInstance): void {
  const cleanupInterval = setInterval(cleanupExpired, 60_000);
  cleanupInterval.unref();

  app.addHook('onRequest', async (request, reply) => {
    const url = request.url;

    if (!url.startsWith('/api/')) {
      return;
    }

    const ip = getClientIP(request);
    const store = STRICT_PATHS.has(url) ? stores.strict : stores.default;
    const limit = STRICT_PATHS.has(url) ? LIMITS.strict : LIMITS.default;

    const now = Date.now();
    let entry = store.get(ip);

    if (!entry || now >= entry.resetTime) {
      entry = { count: 1, resetTime: now + limit.windowMs };
      store.set(ip, entry);
    } else {
      entry.count++;
    }

    const remaining = Math.max(0, limit.max - entry.count);
    const resetSeconds = Math.ceil((entry.resetTime - now) / 1000);

    reply.header('X-RateLimit-Limit', limit.max);
    reply.header('X-RateLimit-Remaining', remaining);
    reply.header('X-RateLimit-Reset', resetSeconds);

    if (entry.count > limit.max) {
      reply.status(429).send({ success: false, error: '请求过于频繁，请稍后再试' });
    }
  });
}