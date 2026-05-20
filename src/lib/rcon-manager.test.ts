import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import * as net from 'node:net';
import { RconManager, getRconManager, closeRconManager } from './rcon-manager.js';

function buildMockPacket(id: number, type: number, payload: string): Buffer {
  const payloadBytes = Buffer.from(payload, 'utf-8');
  const body = Buffer.alloc(10 + payloadBytes.length);
  body.writeInt32LE(id, 0);
  body.writeInt32LE(type, 4);
  payloadBytes.copy(body, 8);

  const header = Buffer.alloc(4);
  header.writeInt32LE(10 + payloadBytes.length, 0);

  return Buffer.concat([header, body]);
}

describe('RconManager', () => {
  let server: net.Server;
  let serverPort: number;

  beforeAll(async () => {
    server = net.createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as net.AddressInfo;
        serverPort = addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(() => {
    server.removeAllListeners('connection');
    closeRconManager();
  });

  it('should send command and auto-connect', async () => {
    server.once('connection', (socket) => {
      socket.once('data', () => {
        socket.write(buildMockPacket(1, 3, ''));
      });
      socket.on('data', (data) => {
        const id = data.readInt32LE(4);
        if (id === 2) {
          socket.write(buildMockPacket(2, 0, 'Version: 2.0.28'));
        }
      });
    });

    vi.spyOn(RconManager.prototype as any, 'constructor').mockImplementation(function (this: RconManager) {
      Object.defineProperty(this, 'settings', {
        value: { host: '127.0.0.1', port: serverPort, password: 'pwd' },
        writable: true,
      });
    });

    const manager = new RconManager();
    manager['settings'] = { host: '127.0.0.1', port: serverPort, password: 'pwd' };

    const result = await manager.sendCommand('/version');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('Version: 2.0.28');
    }
    manager.disconnect();
  });

  it('should reuse existing connection for multiple commands', async () => {
    let authCount = 0;
    server.once('connection', (socket) => {
      socket.once('data', () => {
        authCount++;
        socket.write(buildMockPacket(1, 3, ''));
      });
      socket.on('data', (data) => {
        const id = data.readInt32LE(4);
        if (id >= 2) {
          socket.write(buildMockPacket(id, 0, `Resp-${id}`));
        }
      });
    });

    const manager = new RconManager();
    manager['settings'] = { host: '127.0.0.1', port: serverPort, password: 'pwd' };

    const r1 = await manager.sendCommand('/cmd1');
    expect(r1.ok).toBe(true);

    const r2 = await manager.sendCommand('/cmd2');
    expect(r2.ok).toBe(true);

    expect(authCount).toBe(1);
    manager.disconnect();
  });

  it('should disconnect and clean up state', async () => {
    server.once('connection', (socket) => {
      socket.once('data', () => {
        socket.write(buildMockPacket(1, 3, ''));
      });
    });

    const manager = new RconManager();
    manager['settings'] = { host: '127.0.0.1', port: serverPort, password: 'pwd' };

    await manager.connect();
    expect(manager.isConnected()).toBe(true);

    manager.disconnect();
    expect(manager.isConnected()).toBe(false);
  });

  it('should detect not connected state', () => {
    const manager = new RconManager();
    manager['settings'] = { host: '127.0.0.1', port: serverPort, password: 'pwd' };
    expect(manager.isConnected()).toBe(false);
  });

  it('should return singleton instance', () => {
    const m1 = getRconManager();
    const m2 = getRconManager();
    expect(m1).toBe(m2);
  });

  it('should close manager via closeRconManager', () => {
    const m1 = getRconManager();
    closeRconManager();
    const m2 = getRconManager();
    expect(m1).not.toBe(m2);
  });

  it('should handle connection failure gracefully', async () => {
    const manager = new RconManager();
    manager['settings'] = { host: '127.0.0.1', port: serverPort, password: 'wrong' };

    server.once('connection', (socket) => {
      socket.once('data', () => {
        socket.write(buildMockPacket(-1, 3, ''));
      });
    });

    const result = await manager.sendCommand('/version');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('AUTHENTICATION_FAILED');
    }
  });
});
