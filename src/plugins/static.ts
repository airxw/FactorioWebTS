import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import type { FastifyInstance } from 'fastify';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function registerStatic(app: FastifyInstance): Promise<void> {
  const publicPath = path.resolve(__dirname, '../../public');
  console.log(`Serving static files from: ${publicPath}`);
  
  await app.register(fastifyStatic, {
    root: publicPath,
    prefix: '/',
  });
}