import Fastify from 'fastify';
import { loadEnv } from './config/env.js';
import { registerCors } from './plugins/cors.js';
import { registerWebSocket } from './plugins/websocket.js';
import { registerStatic } from './plugins/static.js';
import { registerRateLimit } from './plugins/rate-limit.js';
import { healthRoutes } from './modules/health/health.routes.js';
import authRoutes from './modules/auth/auth.routes.js';
import shopRoutes from './modules/shop/shop.routes.js';
import cartRoutes from './modules/cart/cart.routes.js';
import vipRoutes from './modules/vip/vip.routes.js';
import playerRoutes from './modules/player/player.routes.js';
import serverRoutes from './modules/server/server.routes.js';
import configRoutes from './modules/config/config.routes.js';
import chatRoutes from './modules/chat/chat.routes.js';
import modRoutes from './modules/mod/mod.routes.js';
import voteRoutes from './modules/vote/vote.routes.js';
import fileRoutes from './modules/file/file.routes.js';
import logRoutes from './modules/log/log.routes.js';
import versionRoutes from './modules/version/version.routes.js';
import backupRoutes from './modules/backup/backup.routes.js';
import { scheduler } from './lib/scheduler.js';
import { commandQueue } from './lib/command-queue.js';
import { initChatEventSubscriptions } from './modules/chat/chat.service.js';
import { startLogWatcher, stopLogWatcher } from './lib/log-watcher.js';
import { logReader } from './lib/log-reader.js';
import { startLogRotationCheck } from './lib/log-rotation.js';

export async function buildApp() {
  const env = loadEnv();

  const weakSecrets = ['secret', 'password', 'jwt-secret', 'changeme', '123456'];
  if (weakSecrets.includes(env.JWT_SECRET.toLowerCase())) {
    console.warn('\n⚠️  WARNING: JWT_SECRET is using a weak/default value!\n');
    console.warn('   Please set a strong, random JWT_SECRET in your .env file.\n');
    console.warn('   Example: JWT_SECRET=$(openssl rand -hex 32)\n');
  }

  if (env.JWT_SECRET.length < 32) {
    console.warn('\n⚠️  WARNING: JWT_SECRET should be at least 32 characters long!\n');
  }

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  });

  await registerCors(app);
  await registerWebSocket(app);

  registerRateLimit(app);

  app.setErrorHandler((rawError, _request, reply) => {
    const error = rawError as { statusCode?: number; message: string };
    const statusCode = error.statusCode || 500;
    const message = statusCode === 500
      ? (process.env.NODE_ENV === 'production' ? '服务器内部错误' : error.message)
      : error.message;
    reply.status(statusCode).send({ success: false, error: message });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ success: false, error: '请求的资源不存在' });
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(shopRoutes);
  await app.register(cartRoutes);
  await app.register(vipRoutes);
  await app.register(playerRoutes);
  await app.register(serverRoutes);
  await app.register(configRoutes);
  await app.register(chatRoutes);
  await app.register(modRoutes);
  await app.register(voteRoutes);
  await app.register(fileRoutes);
  await app.register(logRoutes);
  await app.register(versionRoutes);
  await app.register(backupRoutes);

  await registerStatic(app);

  startLogWatcher();
  initChatEventSubscriptions();
  scheduler.start();
  commandQueue.start();
  const logRotationTimer = startLogRotationCheck();

  process.on('SIGINT', () => {
    scheduler.stop();
    commandQueue.stop();
    logReader.stop();
    stopLogWatcher();
    clearInterval(logRotationTimer);
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    scheduler.stop();
    commandQueue.stop();
    logReader.stop();
    stopLogWatcher();
    clearInterval(logRotationTimer);
    process.exit(0);
  });

  return app;
}
