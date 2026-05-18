import websocketPlugin from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import { verifyToken } from './jwt.js';
import type { JwtPayload } from './jwt.js';

import type { WebSocket } from 'ws';

const WS_OPEN = 1 as const;

interface WsClient {
  socket: WebSocket;
  user: JwtPayload | null;
  subscriptions: Set<string>;
}

export class WsManager {
  private clients = new Map<string, WsClient>();
  private nextId = 0;

  add(socket: WebSocket, user: JwtPayload | null): string {
    const id = String(++this.nextId);
    this.clients.set(id, { socket, user, subscriptions: new Set() });

    socket.on('close', () => {
      this.clients.delete(id);
    });

    socket.on('error', () => {
      this.clients.delete(id);
    });

    return id;
  }

  subscribe(clientId: string, channels: string[]): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.subscriptions = new Set(channels);
  }

  broadcast(channel: string, data: unknown, requireAuth = false): number {
    let sent = 0;
    const payload = JSON.stringify({ channel, data, timestamp: Date.now() });

    for (const [, client] of this.clients) {
      if (client.socket.readyState !== WS_OPEN) continue;
      if (requireAuth && !client.user) continue;
      if (client.subscriptions.has(channel)) {
        client.socket.send(payload);
        sent++;
      }
    }

    return sent;
  }

  broadcastAll(data: unknown): number {
    let sent = 0;
    const payload = JSON.stringify({ data, timestamp: Date.now() });

    for (const [, client] of this.clients) {
      if (client.socket.readyState === WS_OPEN) {
        client.socket.send(payload);
        sent++;
      }
    }

    return sent;
  }

  get onlineCount(): number {
    let count = 0;
    for (const [, client] of this.clients) {
      if (client.socket.readyState === WS_OPEN) count++;
    }
    return count;
  }
}

export const wsManager = new WsManager();

export async function registerWebSocket(app: FastifyInstance): Promise<void> {
  await app.register(websocketPlugin);

  app.get('/ws', { websocket: true }, (socket, req) => {
    const tokenParam = (req.query as Record<string, string>)?.token || '';
    const authHeader = req.headers.authorization || '';
    const token = tokenParam || authHeader.replace(/^Bearer\s+/i, '');

    let user: JwtPayload | null = null;
    if (token) {
      try {
        user = verifyToken(token);
      } catch {}
    }

    const clientId = wsManager.add(socket, user);
    socket.send(JSON.stringify({ type: 'connected', client_id: clientId, authenticated: !!user }));

    const pingInterval = setInterval(() => {
      if (socket.readyState === WS_OPEN) {
        socket.send(JSON.stringify({ type: 'pong', time: Date.now() }));
      }
    }, 30000);

    socket.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());

        switch (msg.type) {
          case 'subscribe':
            wsManager.subscribe(clientId, msg.channels || []);
            socket.send(JSON.stringify({ type: 'subscribed', channels: msg.channels }));
            break;

          case 'unsubscribe':
            wsManager.subscribe(clientId, []);
            break;

          case 'ping':
            socket.send(JSON.stringify({ type: 'pong', time: Date.now() }));
            break;
        }
      } catch {}
    });

    socket.on('close', () => {
      clearInterval(pingInterval);
    });

    socket.on('error', () => {
      clearInterval(pingInterval);
    });
  });

  app.get('/api/ws/stats', async (_request, reply) => {
    return reply.send({
      success: true,
      data: { online_count: wsManager.onlineCount },
    });
  });
}
