import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async (_request, reply) => {
    try {
      return reply.send({
        success: true,
        data: {
          status: 'ok',
          version: '0.1.0',
          timestamp: new Date().toISOString(),
          project: 'FactorioWebTS',
        },
      });
    } catch (e: unknown) {
      const err = e as { message: string };
      return reply.status(500).send({ success: false, error: err.message });
    }
  });
}
