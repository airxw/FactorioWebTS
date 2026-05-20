export class AppError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
  }
}

export interface HealthResponse {
  status: string;
  version: string;
  timestamp: string;
  project: string;
}

export interface EnvConfig {
  PORT: number;
  HOST: string;
  JWT_SECRET: string;
  RCON_HOST: string;
  RCON_PORT: number;
  RCON_PASSWORD: string;
  DB_PATH: string;
  LOG_LEVEL: string;
  CORS_ORIGIN: string;
  FACTORIO_PATH?: string;
  CONFIG_PATH?: string;
  LOGS_PATH?: string;
  LOG_PATH?: string;
  SAVES_PATH?: string;
  MODS_PATH?: string;
  BCRYPT_COST: number;
  SYNC_ITEMS_URL: string;
}
