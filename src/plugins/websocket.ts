import websocketPlugin from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import { verifyToken } from './jwt.js';
import type { JwtPayload } from './jwt.js';
import { logger } from '../lib/logger.js';
import { WS_PING_INTERVAL } from '../config/constants.js';

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
  private channelInitCallbacks = new Map<string, (socket: WebSocket) => void>();

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

  subscribe(clientId: string, channels: string[]): WebSocket | null {
    const client = this.clients.get(clientId);
    if (!client) return null;

    for (const ch of channels) {
      client.subscriptions.add(ch);
    }

    return client.socket;
  }

  unsubscribe(clientId: string, channels: string[]): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    if (channels.length === 0) {
      client.subscriptions.clear();
    } else {
      for (const ch of channels) {
        client.subscriptions.delete(ch);
      }
    }
  }

  onChannelSubscribe(channel: string, callback: (socket: WebSocket) => void): void {
    this.channelInitCallbacks.set(channel, callback);
  }

  triggerChannelInit(socket: WebSocket, channels: string[]): void {
    for (const ch of channels) {
      const cb = this.channelInitCallbacks.get(ch);
      if (cb) cb(socket);
    }
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

    if (!user) {
      logger.warn('WebSocket authentication failed: no valid token provided');
      socket.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
      socket.close(4001);
      return;
    }

    const clientId = wsManager.add(socket, user);
    socket.send(JSON.stringify({ type: 'connected', client_id: clientId, authenticated: true }));

    const pingInterval = setInterval(() => {
      if (socket.readyState === WS_OPEN) {
        socket.send(JSON.stringify({ type: 'pong', time: Date.now() }));
      }
    }, WS_PING_INTERVAL);

    socket.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());

        switch (msg.type) {
          case 'subscribe': {
            const channels = msg.channels || [];
            const clientSocket = wsManager.subscribe(clientId, channels);
            socket.send(JSON.stringify({ type: 'subscribed', channels }));
            if (clientSocket) wsManager.triggerChannelInit(clientSocket, channels);
            break;
          }

          case 'unsubscribe':
            wsManager.unsubscribe(clientId, msg.channels || []);
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
