import 'dotenv/config';
import { z } from 'zod';
import type { EnvConfig } from '../types/index.js';

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  JWT_SECRET: z.string().min(1),
  RCON_HOST: z.string().default('127.0.0.1'),
  RCON_PORT: z.coerce.number().default(27015),
  RCON_PASSWORD: z.string().default(''),
  DB_PATH: z.string().default('./data/factorio.db'),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:8000'),
  FACTORIO_PATH: z.string().optional(),
  CONFIG_PATH: z.string().optional(),
  LOGS_PATH: z.string().optional(),
  LOG_PATH: z.string().optional(),
  SAVES_PATH: z.string().optional(),
  MODS_PATH: z.string().optional(),
  BCRYPT_COST: z.coerce.number().default(12),
  SYNC_ITEMS_URL: z.string().default('https://raw.githubusercontent.com/airxw/factorioitem/main/items.json'),
});

export function loadEnv(): EnvConfig {
  return envSchema.parse(process.env);
}
