import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { healthRoutes } from './health.routes.js';

describe('Health Check', () => {
  it('should return status ok with project identifier', async () => {
    const app = Fastify();
    await app.register(healthRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.data.version).toBe('0.1.0');
    expect(body.data.project).toBe('FactorioWebTS');
    expect(body.data.timestamp).toBeDefined();

    await app.close();
  });
});
