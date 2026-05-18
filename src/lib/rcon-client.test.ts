import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as net from 'node:net';
import { RconConnection } from './rcon-client.js';

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

describe('RconConnection integration', () => {
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
  });

  it('should connect and authenticate successfully', async () => {
    server.once('connection', (socket) => {
      socket.once('data', () => {
        socket.write(buildMockPacket(1, 3, ''));
      });
    });

    const conn = new RconConnection('127.0.0.1', serverPort, 'correct', 5000, 3000);
    const result = await conn.connect();

    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toBe(true);
    conn.disconnect();
  });

  it('should detect authentication failure (id=-1)', async () => {
    server.once('connection', (socket) => {
      socket.once('data', () => {
        socket.write(buildMockPacket(-1, 3, ''));
      });
    });

    const conn = new RconConnection('127.0.0.1', serverPort, 'wrong', 5000, 3000);
    const result = await conn.connect();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('AUTHENTICATION_FAILED');
    }
    conn.disconnect();
  });

  it('should handle auth with preceding RESPONSE_VALUE echo', async () => {
    server.once('connection', (socket) => {
      socket.once('data', () => {
        socket.write(buildMockPacket(1, 0, ''));
        socket.write(buildMockPacket(1, 3, ''));
      });
    });

    const conn = new RconConnection('127.0.0.1', serverPort, 'pwd', 5000, 3000);
    const result = await conn.connect();

    expect(result.ok).toBe(true);
    conn.disconnect();
  });

  it('should send command and receive response', async () => {
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

    const conn = new RconConnection('127.0.0.1', serverPort, 'pwd', 5000, 3000);
    const authResult = await conn.connect();
    expect(authResult.ok).toBe(true);

    const cmdResult = await conn.sendCommand('/version');
    expect(cmdResult.ok).toBe(true);
    if (cmdResult.ok) {
      expect(cmdResult.value).toBe('Version: 2.0.28');
    }
    conn.disconnect();
  });

  it('should handle sticky packets (multiple packets in one data event)', async () => {
    server.once('connection', (socket) => {
      socket.on('data', (data) => {
        const id = data.readInt32LE(4);
        if (id === 1) {
          const authResp = buildMockPacket(1, 3, '');
          const rconResp1 = buildMockPacket(2, 0, 'PlayerA (online)');
          const rconResp2 = buildMockPacket(3, 0, 'Version: 1.0.0');
          socket.write(Buffer.concat([authResp, rconResp1, rconResp2]));
        }
      });
    });

    const conn = new RconConnection('127.0.0.1', serverPort, 'pwd', 5000, 3000);
    const authResult = await conn.connect();
    expect(authResult.ok).toBe(true);

    const result1 = await conn.sendCommand('/players');
    expect(result1.ok).toBe(true);
    if (result1.ok) expect(result1.value).toBe('PlayerA (online)');

    const result2 = await conn.sendCommand('/version');
    expect(result2.ok).toBe(true);
    if (result2.ok) expect(result2.value).toBe('Version: 1.0.0');

    conn.disconnect();
  });

  it('should handle fragmented packets (data split across events)', async () => {
    server.once('connection', (socket) => {
      socket.once('data', () => {
        socket.write(buildMockPacket(1, 3, ''));
      });
      socket.on('data', (data) => {
        const id = data.readInt32LE(4);
        if (id === 2) {
          const full = buildMockPacket(2, 0, 'Hello World!');
          socket.write(full.subarray(0, 8));
          setTimeout(() => {
            socket.write(full.subarray(8));
          }, 50);
        }
      });
    });

    const conn = new RconConnection('127.0.0.1', serverPort, 'pwd', 5000, 3000);
    const authResult = await conn.connect();
    expect(authResult.ok).toBe(true);

    const cmdResult = await conn.sendCommand('/say Hello');
    expect(cmdResult.ok).toBe(true);
    if (cmdResult.ok) {
      expect(cmdResult.value).toBe('Hello World!');
    }
    conn.disconnect();
  });

  it('should return error for not connected', async () => {
    const conn = new RconConnection('127.0.0.1', 27015, 'pwd', 5000, 3000);
    const result = await conn.sendCommand('/version');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_CONNECTED');
    }
  });

  it('should handle connect timeout', async () => {
    const conn = new RconConnection('192.0.2.1', 27015, 'pwd', 500, 3000);
    const result = await conn.connect();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONNECT_TIMEOUT');
    }
  });

  it('should handle multiple concurrent commands on same connection', async () => {
    let commandCount = 0;
    server.once('connection', (socket) => {
      socket.once('data', () => {
        socket.write(buildMockPacket(1, 3, ''));
      });
      socket.on('data', (data) => {
        const id = data.readInt32LE(4);
        if (id >= 2) {
          commandCount++;
          socket.write(buildMockPacket(id, 0, `Response-${id}`));
        }
      });
    });

    const conn = new RconConnection('127.0.0.1', serverPort, 'pwd', 5000, 3000);
    const authResult = await conn.connect();
    expect(authResult.ok).toBe(true);

    const [r1, r2, r3] = await Promise.all([
      conn.sendCommand('/cmd1'),
      conn.sendCommand('/cmd2'),
      conn.sendCommand('/cmd3'),
    ]);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(true);
    if (r1.ok) expect(r1.value).toBe('Response-2');
    if (r2.ok) expect(r2.value).toBe('Response-3');
    if (r3.ok) expect(r3.value).toBe('Response-4');

    conn.disconnect();
  });

  it('should timeout on missing response', async () => {
    server.once('connection', (socket) => {
      socket.once('data', () => {
        socket.write(buildMockPacket(1, 3, ''));
      });
    });

    const conn = new RconConnection('127.0.0.1', serverPort, 'pwd', 5000, 500);
    const authResult = await conn.connect();
    expect(authResult.ok).toBe(true);

    const cmdResult = await conn.sendCommand('/version');
    expect(cmdResult.ok).toBe(false);
    if (!cmdResult.ok) {
      expect(cmdResult.error.code).toBe('READ_TIMEOUT');
    }
    conn.disconnect();
  });
});