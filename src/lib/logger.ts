import pino from 'pino';
import { loadEnv } from '../config/env.js';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const env = loadEnv();

const logsDir = path.resolve(process.cwd(), 'logs');
if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });

const streams: pino.StreamEntry[] = [];

streams.push({ level: env.LOG_LEVEL as pino.Level, stream: pino.destination({ dest: path.join(logsDir, 'app.log'), sync: true }) });

if (process.env.NODE_ENV !== 'production') {
  streams.push({
    level: env.LOG_LEVEL as pino.Level,
    stream: pino.transport({ target: 'pino-pretty', options: { colorize: true } }),
  });
}

export const logger = pino({ level: env.LOG_LEVEL as pino.Level }, pino.multistream(streams));
