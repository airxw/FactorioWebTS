import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

async function start() {
  const env = loadEnv();
  const app = await buildApp();

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info({ port: env.PORT }, 'Server started');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
