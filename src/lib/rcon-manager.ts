import { RconConnection } from './rcon-client.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveConfigDir } from './paths.js';
import { logger } from './logger.js';
import { rconErr, type RconResult } from './rcon-types.js';
import {
  RCON_RECONNECT_BASE_DELAY_MS,
  RCON_RECONNECT_MAX_DELAY_MS,
  RCON_RECONNECT_BACKOFF_MULTIPLIER,
  RCON_RECONNECT_MAX_ATTEMPTS,
} from '../config/constants.js';
import { loadEnv } from '../config/env.js';

interface RconSettings {
  host: string;
  port: number;
  password: string;
}

export function resolveRconSettings(): RconSettings {
  const env = loadEnv();
  const settings: RconSettings = {
    host: env.RCON_HOST,
    port: env.RCON_PORT,
    password: env.RCON_PASSWORD || '',
  };

  try {
    const configDir = resolveConfigDir();
    const serverSettingsPath = path.join(configDir, 'server-settings.json');
    if (existsSync(serverSettingsPath)) {
      const raw = readFileSync(serverSettingsPath, 'utf-8');
      const json = JSON.parse(raw);

      const portFromJson = parseInt(json.rcon_port || json['rcon-port'] || '0', 10);
      if (portFromJson > 0 && portFromJson <= 65535) {
        settings.port = portFromJson;
      }

      const pwdFromJson = json.rcon_password || json['rcon-password'];
      if (pwdFromJson && typeof pwdFromJson === 'string' && pwdFromJson.length > 0) {
        settings.password = pwdFromJson;
      }
    }
  } catch (e) { logger.warn({ err: e }, '[RCON] Failed to read server-settings.json for RCON config'); }

  return settings;
}

export class RconManager {
  private conn: RconConnection | null = null;
  private settings: RconSettings;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private intentionalDisconnect = false;
  private connectPromise: Promise<RconResult<boolean>> | null = null;

  constructor() {
    this.settings = resolveRconSettings();
  }

  async connect(): Promise<RconResult<boolean>> {
    if (this.intentionalDisconnect) {
      return rconErr('NOT_CONNECTED', 'RCON intentionally disconnected');
    }

    if (this.conn && this.conn.isConnected()) {
      return { ok: true, value: true };
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.doConnect();
    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async doConnect(): Promise<RconResult<boolean>> {
    this.settings = resolveRconSettings();
    const connection = new RconConnection(
      this.settings.host,
      this.settings.port,
      this.settings.password
    );

    const result = await connection.connect();
    if (!result.ok || !result.value) {
      return result;
    }

    if (this.intentionalDisconnect) {
      connection.disconnect();
      return rconErr('NOT_CONNECTED', 'RCON intentionally disconnected during connect');
    }

    this.conn = connection;
    this.intentionalDisconnect = false;

    connection.setOnClose(() => {
      if (!this.intentionalDisconnect) {
        this.conn = null;
        this.startReconnect();
      }
    });

    return { ok: true, value: true };
  }

  async sendCommand(command: string): Promise<RconResult<string>> {
    if (!this.conn || !this.conn.isConnected()) {
      const connectResult = await this.connect();
      if (!connectResult.ok || !connectResult.value) {
        return connectResult.ok
          ? rconErr('NOT_CONNECTED', 'RCON not connected')
          : connectResult;
      }
    }

    const result = await this.conn!.sendCommand(command);
    if (!result.ok && (result.error.code === 'DISCONNECTED' || result.error.code === 'NOT_CONNECTED')) {
      if (!this.intentionalDisconnect) {
        this.conn = null;
        this.startReconnect();
      }
    }
    return result;
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    this.stopReconnect();
    this.connectPromise = null;

    if (this.conn) {
      this.conn.disconnect();
      this.conn = null;
    }
  }

  isConnected(): boolean {
    return this.conn !== null && this.conn.isConnected();
  }

  startReconnect(): void {
    if (this.intentionalDisconnect) return;
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts >= RCON_RECONNECT_MAX_ATTEMPTS) return;

    const delay = Math.min(
      RCON_RECONNECT_BASE_DELAY_MS * Math.pow(RCON_RECONNECT_BACKOFF_MULTIPLIER, this.reconnectAttempts),
      RCON_RECONNECT_MAX_DELAY_MS
    );

    logger.info(
      { attempt: this.reconnectAttempts + 1, delayMs: delay, host: this.settings.host, port: this.settings.port },
      '[RCON] Scheduling reconnect'
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      if (this.intentionalDisconnect) return;

      const result = await this.connect();

      if (result.ok && result.value) {
        this.reconnectAttempts = 0;
        logger.info({ host: this.settings.host, port: this.settings.port }, '[RCON] Reconnected');
        return;
      }

      this.reconnectAttempts++;
      logger.warn(
        { attempt: this.reconnectAttempts, host: this.settings.host, port: this.settings.port },
        '[RCON] Reconnect failed'
      );

      if (this.reconnectAttempts >= RCON_RECONNECT_MAX_ATTEMPTS) {
        logger.error(
          { host: this.settings.host, port: this.settings.port, maxAttempts: RCON_RECONNECT_MAX_ATTEMPTS },
          '[RCON] Max reconnect attempts reached, giving up'
        );
        return;
      }

      this.startReconnect();
    }, delay);
  }

  private stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
  }
}

let manager: RconManager | null = null;

export function getRconManager(): RconManager {
  if (!manager) {
    manager = new RconManager();
  }
  return manager;
}

export function closeRconManager(): void {
  if (manager) {
    manager.disconnect();
    manager = null;
  }
}

export async function executeRconCommand(command: string): Promise<RconResult<string>> {
  return getRconManager().sendCommand(command);
}
