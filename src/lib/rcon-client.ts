import * as net from 'node:net';
import { logger } from './logger.js';
import { RconError, rconOk, rconErr, type RconResult } from './rcon-types.js';

const SERVERDATA_AUTH = 3;
const SERVERDATA_EXECCOMMAND = 2;
const SERVERDATA_RESPONSE_VALUE = 0;

const MIN_PACKET_SIZE = 10;

export interface RconPacket {
  id: number;
  type: number;
  payload: string;
}

interface PendingCommand {
  resolve: (result: RconResult<string>) => void;
  requestId: number;
  collected: string;
  auth: boolean;
  authResolve?: (result: RconResult<boolean>) => void;
  timer: NodeJS.Timeout;
}

export class RconConnection {
  private socket: net.Socket | null = null;
  private nextRequestId = 0;
  private host: string;
  private port: number;
  private password: string;
  private connectTimeout: number;
  private readTimeout: number;

  private readBuffer = Buffer.alloc(0);
  private pending = new Map<number, PendingCommand>();
  private writeQueue: Array<{ packet: Buffer; requestId: number }> = [];
  private writing = false;
  private onCloseCallback: (() => void) | null = null;

  constructor(
    host: string,
    port: number,
    password: string,
    connectTimeout = 5000,
    readTimeout = 5000
  ) {
    this.host = host;
    this.port = port;
    this.password = password;
    this.connectTimeout = connectTimeout;
    this.readTimeout = readTimeout;
  }

  async connect(): Promise<RconResult<boolean>> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 30000);

      const connectTimer = setTimeout(() => {
        socket.destroy();
        resolve(rconErr('CONNECT_TIMEOUT', `RCON connect timeout to ${this.host}:${this.port}`));
      }, this.connectTimeout);

      socket.connect(this.port, this.host, () => {
        clearTimeout(connectTimer);
        this.socket = socket;
        this.readBuffer = Buffer.alloc(0);
        this.setupReader();

        this.authenticateRequest().then((authResult) => {
          if (!authResult.ok) {
            this.disconnect();
            resolve(authResult);
            return;
          }
          if (!authResult.value) {
            this.disconnect();
            resolve(rconErr('AUTHENTICATION_FAILED', 'Authentication rejected'));
            return;
          }
          resolve(rconOk(true));
        });
      });

      socket.on('error', (err: Error) => {
        clearTimeout(connectTimer);
        this.disconnect();
        resolve(rconErr('CONNECTION_FAILED', `RCON connection error: ${err.message}`));
      });

      socket.on('close', () => {
        this.rejectAllPending(rconErr('DISCONNECTED', 'Connection closed'));
        if (this.onCloseCallback) this.onCloseCallback();
      });
    });
  }

  private setupReader(): void {
    if (!this.socket) return;

    this.socket.on('data', (chunk: Buffer) => {
      this.readBuffer = Buffer.concat([this.readBuffer, chunk]);
      this.processReadBuffer();
    });
  }

  private processReadBuffer(): void {
    while (this.readBuffer.length >= 4) {
      const size = this.readBuffer.readInt32LE(0);
      if (size < MIN_PACKET_SIZE) {
        logger.warn({ host: this.host, port: this.port }, '[RCON] Received invalid packet size');
        this.readBuffer = Buffer.alloc(0);
        return;
      }

      const totalLen = 4 + size;
      if (this.readBuffer.length < totalLen) return;

      const packet = this.parsePacket(this.readBuffer.subarray(0, totalLen));
      this.readBuffer = this.readBuffer.subarray(totalLen);

      if (!packet) continue;

      this.dispatchPacket(packet);
    }
  }

  private parsePacket(buffer: Buffer): RconPacket | null {
    try {
      const size = buffer.readInt32LE(0);
      const id = buffer.readInt32LE(4);
      const type = buffer.readInt32LE(8);
      const payload = buffer.toString('utf-8', 12, 4 + size - 2);
      return { id, type, payload };
    } catch {
      return null;
    }
  }

  private dispatchPacket(packet: RconPacket): void {
    const cmd = this.pending.get(packet.id);
    if (!cmd) {
      if (this.pending.size === 0 && packet.type === SERVERDATA_RESPONSE_VALUE) {
        return;
      }
      logger.warn({ id: packet.id, type: packet.type }, '[RCON] Received unexpected packet id');
      return;
    }

    if (cmd.auth) {
      this.handleAuthPacket(cmd, packet);
      return;
    }

    if (packet.type === SERVERDATA_RESPONSE_VALUE) {
      cmd.collected += packet.payload;
      clearTimeout(cmd.timer);

      cmd.timer = setTimeout(() => {
        const p = this.pending.get(cmd.requestId);
        if (p) {
          this.pending.delete(cmd.requestId);
          p.resolve(rconOk(cmd.collected));
        }
      }, 50);
    } else {
      clearTimeout(cmd.timer);
      this.pending.delete(cmd.requestId);

      if (cmd.collected.length > 0) {
        cmd.resolve(rconOk(cmd.collected));
      } else {
        cmd.resolve(rconOk(''));
      }
    }
  }

  private handleAuthPacket(cmd: PendingCommand, packet: RconPacket): void {
    if (packet.type === SERVERDATA_RESPONSE_VALUE) {
      return;
    }

    clearTimeout(cmd.timer);
    this.pending.delete(cmd.requestId);

    if (packet.type === SERVERDATA_AUTH) {
      if (packet.id !== -1) {
        cmd.authResolve?.(rconOk(true));
      } else {
        cmd.authResolve?.(rconOk(false));
      }
    } else {
      cmd.authResolve?.(rconOk(false));
    }
  }

  private authenticateRequest(): Promise<RconResult<boolean>> {
    return new Promise((resolve) => {
      const requestId = ++this.nextRequestId;
      const packet = this.buildPacket(requestId, SERVERDATA_AUTH, this.password);

      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve(rconErr('READ_TIMEOUT', 'RCON authentication read timeout'));
      }, this.readTimeout);

      this.pending.set(requestId, {
        resolve: () => {},
        requestId,
        collected: '',
        auth: true,
        authResolve: resolve,
        timer,
      });

      this.enqueueWrite(packet, requestId);
    });
  }

  async sendCommand(command: string): Promise<RconResult<string>> {
    if (!this.isConnected()) {
      return rconErr('NOT_CONNECTED', 'Socket is not connected');
    }

    return new Promise((resolve) => {
      const requestId = ++this.nextRequestId;
      const packet = this.buildPacket(requestId, SERVERDATA_EXECCOMMAND, command);

      const timer = setTimeout(() => {
        const cmd = this.pending.get(requestId);
        if (cmd) {
          this.pending.delete(requestId);
          if (cmd.collected.length > 0) {
            resolve(rconOk(cmd.collected));
          } else {
            resolve(rconErr('READ_TIMEOUT', `RCON read timeout for "${command}"`));
          }
        }
      }, this.readTimeout);

      this.pending.set(requestId, {
        resolve,
        requestId,
        collected: '',
        auth: false,
        timer,
      });

      this.enqueueWrite(packet, requestId);
    });
  }

  private enqueueWrite(packet: Buffer, requestId: number): void {
    this.writeQueue.push({ packet, requestId });
    this.processWriteQueue();
  }

  private processWriteQueue(): void {
    if (this.writing || this.writeQueue.length === 0) return;
    if (!this.socket || !this.isConnected()) {
      for (const item of this.writeQueue) {
        const cmd = this.pending.get(item.requestId);
        if (cmd) {
          clearTimeout(cmd.timer);
          this.pending.delete(item.requestId);
          if (cmd.auth) {
            cmd.authResolve?.(rconErr('NOT_CONNECTED', 'Socket disconnected during write'));
          } else {
            cmd.resolve(rconErr('NOT_CONNECTED', 'Socket disconnected during write'));
          }
        }
      }
      this.writeQueue = [];
      return;
    }

    this.writing = true;

    while (this.writeQueue.length > 0) {
      const item = this.writeQueue.shift()!;
      try {
        this.socket!.write(item.packet);
      } catch (err) {
        const cmd = this.pending.get(item.requestId);
        if (cmd) {
          clearTimeout(cmd.timer);
          this.pending.delete(item.requestId);
          if (cmd.auth) {
            cmd.authResolve?.(rconErr('CONNECTION_FAILED', `Write error: ${(err as Error).message}`));
          } else {
            cmd.resolve(rconErr('CONNECTION_FAILED', `Write error: ${(err as Error).message}`));
          }
        }
      }
    }

    this.writing = false;
  }

  private buildPacket(id: number, type: number, payload: string): Buffer {
    const payloadBytes = Buffer.from(payload, 'utf-8');
    const body = Buffer.alloc(10 + payloadBytes.length);

    body.writeInt32LE(id, 0);
    body.writeInt32LE(type, 4);
    payloadBytes.copy(body, 8);

    const header = Buffer.alloc(4);
    header.writeInt32LE(10 + payloadBytes.length, 0);

    return Buffer.concat([header, body]);
  }

  private rejectAllPending(error: RconResult<never>): void {
    for (const [id, cmd] of this.pending) {
      clearTimeout(cmd.timer);
      this.pending.delete(id);
      if (cmd.auth) {
        cmd.authResolve?.(error);
      } else {
        cmd.resolve(error);
      }
    }
  }

  isConnected(): boolean {
    return this.socket !== null && !this.socket.destroyed && this.socket.readyState === 'open';
  }

  setOnClose(cb: (() => void) | null): void {
    this.onCloseCallback = cb;
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners('data');
      this.socket.destroy();
      this.socket = null;
    }
    this.rejectAllPending(rconErr('DISCONNECTED', 'Connection explicitly closed'));
    this.readBuffer = Buffer.alloc(0);
  }
}