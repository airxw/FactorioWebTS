import { RconConnection } from './rcon-client.js';
import { loadEnv } from '../config/env.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveConfigDir } from './paths.js';

function resolveRconPassword(): string {
  const env = loadEnv();
  if (env.RCON_PASSWORD) return env.RCON_PASSWORD;

  try {
    const configDir = resolveConfigDir();
    const serverSettingsPath = path.join(configDir, 'server-settings.json');
    if (existsSync(serverSettingsPath)) {
      const raw = readFileSync(serverSettingsPath, 'utf-8');
      const settings = JSON.parse(raw);
      if (settings.rcon_password && typeof settings.rcon_password === 'string') {
        return settings.rcon_password;
      }
      if (settings['rcon-password'] && typeof settings['rcon-password'] === 'string') {
        return settings['rcon-password'];
      }
    }
  } catch {}

  return '';
}

interface PooledConnection {
  conn: RconConnection;
  inUse: boolean;
  lastUsed: number;
}

export class RconPool {
  private connections: Map<number, PooledConnection> = new Map();
  private maxConnections: number;
  private idleTimeoutMs: number;
  private host: string;
  private port: number;
  private password: string;
  private nextKey = 0;

  constructor(maxConnections = 5, idleTimeoutMs = 30000) {
    const env = loadEnv();
    this.host = env.RCON_HOST;
    this.port = env.RCON_PORT;
    this.password = resolveRconPassword();
    this.maxConnections = maxConnections;
    this.idleTimeoutMs = idleTimeoutMs;
  }

  async acquire(): Promise<RconConnection | null> {
    this.cleanupIdle();

    for (const [, pooled] of this.connections) {
      if (!pooled.inUse && pooled.conn.isConnected()) {
        pooled.inUse = true;
        pooled.lastUsed = Date.now();
        return pooled.conn;
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
      }
    }

    const conn = new RconConnection(this.host, this.port, this.password);
    const connected = await conn.connect();

    if (!connected) {
      return null;
    }

    const key = ++this.nextKey;
    this.connections.set(key, {
      conn,
      inUse: true,
      lastUsed: Date.now(),
    });

    return conn;
  }

  release(conn: RconConnection): void {
    for (const [, pooled] of this.connections) {
      if (pooled.conn === conn) {
        pooled.inUse = false;
        pooled.lastUsed = Date.now();
        return;
      }
    }
  }

  async execute(command: string): Promise<string> {
    const conn = await this.acquire();
    if (!conn) {
      return '';
    }

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
    for (const [, pooled] of this.connections) {
      pooled.conn.disconnect();
    }
    this.connections.clear();
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

export async function executeRconCommand(command: string): Promise<string> {
  return getRconPool().execute(command);
}
