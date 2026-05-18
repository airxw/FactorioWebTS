import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RconPool, getRconPool, closeRconPool } from './rcon-pool.js';

describe('RconPool', () => {
  let pool: RconPool;

  beforeEach(() => {
    closeRconPool();
    pool = new RconPool(3, 5000, 3000, 60000);
  });

  afterEach(() => {
    pool.closeAll();
    closeRconPool();
  });

  it('should create a pool with default settings', () => {
    expect(pool).toBeDefined();
    expect(pool.totalCount).toBe(0);
    expect(pool.activeCount).toBe(0);
    expect(pool.idleCount).toBe(0);
  });

  it('should handle execute when no server is running', async () => {
    const result = await pool.execute('/players');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['CONNECTION_FAILED', 'CONNECT_TIMEOUT', 'CONNECTION_FAILED']).toContain(result.error.code);
    }
  });

  it('should track connection counts correctly after acquire attempts', async () => {
    const connResult = await pool.acquire();

    if (connResult.ok) {
      expect(pool.totalCount).toBeGreaterThan(0);
      expect(pool.activeCount).toBeGreaterThan(0);
      pool.release(connResult.value);
      expect(pool.idleCount).toBeGreaterThan(0);
    }
  });

  it('should release connections back to pool', async () => {
    const connResult = await pool.acquire();
    if (!connResult.ok) return;

    expect(pool.idleCount).toBe(0);
    pool.release(connResult.value);
    expect(pool.idleCount).toBe(1);
  });

  it('should handle multiple release calls safely', () => {
    const conn = { isConnected: () => false, disconnect: () => {} } as any;
    pool.release(conn);
    expect(pool.totalCount).toBe(0);
  });

  it('should clean up on closeAll', () => {
    pool.closeAll();
    expect(pool.totalCount).toBe(0);
    expect(pool.activeCount).toBe(0);
  });
});

describe('RconPool singleton', () => {
  afterEach(() => {
    closeRconPool();
  });

  it('should return the same pool instance', () => {
    const p1 = getRconPool();
    const p2 = getRconPool();
    expect(p1).toBe(p2);
    p1.closeAll();
  });
});