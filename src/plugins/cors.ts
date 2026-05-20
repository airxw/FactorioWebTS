import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import { loadEnv } from '../config/env.js';

export async function registerCors(app: FastifyInstance): Promise<void> {
  const env = loadEnv();
  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });
}
