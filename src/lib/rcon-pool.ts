import { RconConnection } from './rcon-client.js';
import { loadEnv } from '../config/env.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveConfigDir } from './paths.js';
import { logger } from './logger.js';
import { rconErr, type RconResult, type RconError } from './rcon-types.js';

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

      const pwdFromJson = json.rcon_password || json['rcon-password'] || json.rcon_password_hash || json['rcon-password-hash'];
      if (pwdFromJson && typeof pwdFromJson === 'string' && pwdFromJson.length > 0) {
        settings.password = pwdFromJson;
      }
    }
  } catch {}

  return settings;
}

interface PooledConnection {
  conn: RconConnection;
  inUse: boolean;
  lastUsed: number;
}

type PendingAcquire = {
  resolve: (conn: RconResult<RconConnection>) => void;
  timer: NodeJS.Timeout;
};

export class RconPool {
  private connections: Map<number, PooledConnection> = new Map();
  private maxConnections: number;
  private idleTimeoutMs: number;
  private healthCheckMs: number;
  private acquireTimeoutMs: number;
  private waiters: PendingAcquire[] = [];
  private nextKey = 0;
  private settings: RconSettings;
  private healthTimer: NodeJS.Timeout | null = null;

  constructor(maxConnections = 5, idleTimeoutMs = 30000, acquireTimeoutMs = 30000, healthCheckMs = 60000) {
    this.maxConnections = maxConnections;
    this.idleTimeoutMs = idleTimeoutMs;
    this.acquireTimeoutMs = acquireTimeoutMs;
    this.healthCheckMs = healthCheckMs;
    this.settings = resolveRconSettings();
    this.startHealthCheck();
  }

  private startHealthCheck(): void {
    this.healthTimer = setInterval(() => {
      this.cleanupDeadConnections();
    }, this.healthCheckMs);
  }

  private async cleanupDeadConnections(): Promise<void> {
    const toRemove: number[] = [];
    for (const [key, pooled] of this.connections) {
      if (pooled.inUse) continue;
      if (!pooled.conn.isConnected()) {
        toRemove.push(key);
      }
    }

    for (const key of toRemove) {
      const pooled = this.connections.get(key);
      if (pooled) {
        pooled.conn.disconnect();
        this.connections.delete(key);
      }
    }

    if (toRemove.length > 0) {
      logger.info({ removed: toRemove.length }, '[RCON-Pool] Cleanup dead connections');
    }
  }

  async acquire(): Promise<RconResult<RconConnection>> {
    this.cleanupIdle();

    for (const [, pooled] of this.connections) {
      if (!pooled.inUse && pooled.conn.isConnected()) {
        pooled.inUse = true;
        pooled.lastUsed = Date.now();
        return { ok: true, value: pooled.conn };
      }
    }

    if (this.connections.size >= this.maxConnections) {
      let oldestKey = -1;
      let oldestTime = Infinity;

      for (const [key, pooled] of this.connections) {
        if (!pooled.inUse && pooled.lastUsed < oldestTime) {
          oldestTime = pooled.lastUsed;
          oldestKey = key;
        }
      }

      if (oldestKey >= 0) {
        const old = this.connections.get(oldestKey)!;
        old.conn.disconnect();
        this.connections.delete(oldestKey);
      } else {
        return this.enqueueWaiter();
      }
    }

    const conn = new RconConnection(this.settings.host, this.settings.port, this.settings.password);
    const connected = await conn.connect();

    if (!connected.ok || !connected.value) {
      const err = connected.ok
        ? rconErr('CONNECTION_FAILED', 'Failed to connect (no details)')
        : connected;
      logger.warn({ host: this.settings.host, port: this.settings.port, poolSize: this.connections.size }, '[RCON-Pool] Unable to create new connection');
      return err;
    }

    const key = ++this.nextKey;
    this.connections.set(key, {
      conn,
      inUse: true,
      lastUsed: Date.now(),
    });

    logger.info({ host: this.settings.host, port: this.settings.port, poolSize: this.connections.size }, '[RCON-Pool] Created new connection');
    return { ok: true, value: conn };
  }

  private enqueueWaiter(): Promise<RconResult<RconConnection>> {
    return new Promise((resolve) => {
      logger.warn(
        { host: this.settings.host, port: this.settings.port, poolSize: this.connections.size, maxConnections: this.maxConnections },
        '[RCON-Pool] All connections busy, waiting...'
      );

      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.timer === timer);
        if (idx >= 0) {
          this.waiters.splice(idx, 1);
          resolve(rconErr('POOL_EXHAUSTED', 'Pool wait timeout, no connection available'));
        }
      }, this.acquireTimeoutMs);

      this.waiters.push({ resolve, timer });
    });
  }

  release(conn: RconConnection): void {
    for (const [key, pooled] of this.connections) {
      if (pooled.conn === conn) {
        pooled.inUse = false;
        pooled.lastUsed = Date.now();

        if (this.waiters.length > 0) {
          const waiter = this.waiters.shift()!;
          clearTimeout(waiter.timer);
          pooled.inUse = true;
          pooled.lastUsed = Date.now();
          // We need to call waiter.resolve outside the loop
          // But since we break right after, it's fine with setTimeout
          setImmediate(() => waiter.resolve({ ok: true, value: conn }));
          break;
        }
        break;
      }
    }
  }

  async execute(command: string): Promise<RconResult<string>> {
    const connResult = await this.acquire();
    if (!connResult.ok) {
      return connResult;
    }

    const conn = connResult.value;
    try {
      return await conn.sendCommand(command);
    } finally {
      this.release(conn);
    }
  }

  private cleanupIdle(): void {
    const now = Date.now();
    const toRemove: number[] = [];

    for (const [key, pooled] of this.connections) {
      if (!pooled.inUse && now - pooled.lastUsed > this.idleTimeoutMs) {
        pooled.conn.disconnect();
        toRemove.push(key);
      }
    }

    for (const key of toRemove) {
      this.connections.delete(key);
    }
  }

  closeAll(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }

    for (const [, pooled] of this.connections) {
      pooled.conn.disconnect();
    }
    this.connections.clear();

    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(rconErr('DISCONNECTED', 'Pool closed'));
    }
    this.waiters = [];
  }

  get activeCount(): number {
    let count = 0;
    for (const [, p] of this.connections) {
      if (p.inUse) count++;
    }
    return count;
  }

  get idleCount(): number {
    return this.connections.size - this.activeCount;
  }

  get totalCount(): number {
    return this.connections.size;
  }
}

let pool: RconPool | null = null;

export function getRconPool(): RconPool {
  if (!pool) {
    pool = new RconPool();
  }
  return pool;
}

export function closeRconPool(): void {
  if (pool) {
    pool.closeAll();
    pool = null;
  }
}

export async function executeRconCommand(command: string): Promise<RconResult<string>> {
  return getRconPool().execute(command);
}