import * as net from 'node:net';

const SERVERDATA_AUTH = 3;
const SERVERDATA_EXECCOMMAND = 2;
const SERVERDATA_RESPONSE_VALUE = 0;

export interface RconPacket {
  id: number;
  type: number;
  payload: string;
}

export class RconConnection {
  private socket: net.Socket | null = null;
  private requestId = 0;
  private host: string;
  private port: number;
  private password: string;
  private connectTimeout: number;
  private readTimeout: number;

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

  async connect(): Promise<boolean> {
    return new Promise((resolve) => {
      this.socket = new net.Socket();
      this.socket.setNoDelay(true);

      const timer = setTimeout(() => {
        this.socket?.destroy();
        resolve(false);
      }, this.connectTimeout);

      this.socket.connect(this.port, this.host, async () => {
        clearTimeout(timer);
        try {
          const authenticated = await this.authenticate();
          if (!authenticated) {
            this.disconnect();
          }
          resolve(authenticated);
        } catch {
          this.disconnect();
          resolve(false);
        }
      });

      this.socket.on('error', () => {
        clearTimeout(timer);
        this.disconnect();
        resolve(false);
      });
    });
  }

  private async authenticate(): Promise<boolean> {
    this.requestId++;
    const id = this.requestId;

    const authPacket = this.buildPacket(id, SERVERDATA_AUTH, this.password);
    if (!this.socket) return false;
    this.socket.write(authPacket);

    const responsePacket = await this.readPacket();
    if (!responsePacket) return false;

    const authResult = await this.readPacket();
    if (!authResult) return false;

    return authResult.id !== -1;
  }

  async sendCommand(command: string): Promise<string> {
    if (!this.isConnected()) {
      await this.connect();
    }

    if (!this.socket || !this.isConnected()) {
      return '';
    }

    this.requestId++;
    const id = this.requestId;

    const packet = this.buildPacket(id, SERVERDATA_EXECCOMMAND, command);
    this.socket.write(packet);

    return this.collectResponse(id);
  }

  private async collectResponse(id: number): Promise<string> {
    let response = '';

    while (true) {
      const pkt = await this.readPacket();
      if (!pkt) break;

      if (pkt.id === id && pkt.type === SERVERDATA_RESPONSE_VALUE) {
        response += pkt.payload;
      }

      if (pkt.id === id && pkt.type !== SERVERDATA_RESPONSE_VALUE) {
        break;
      }

      const terminatorId = id + 10000;
      const probe = this.buildPacket(terminatorId, SERVERDATA_EXECCOMMAND, '');
      if (!this.socket) break;
      this.socket.write(probe);

      const terminator = await this.readPacket();
      if (terminator && terminator.id === terminatorId) {
        break;
      }
    }

    return response;
  }

  private async readPacket(): Promise<RconPacket | null> {
    if (!this.socket) return null;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, this.readTimeout);

      const cleanup = () => {
        clearTimeout(timer);
        this.socket?.removeListener('data', onData);
        this.socket?.removeListener('error', onError);
      };

      let buffer = Buffer.alloc(0);

      const onData = (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);

        if (buffer.length < 4) return;

        const size = buffer.readInt32LE(0);

        if (size < 10) {
          cleanup();
          resolve(null);
          return;
        }

        const totalLen = 4 + size;
        if (buffer.length < totalLen) return;

        cleanup();

        const id = buffer.readInt32LE(4);
        const type = buffer.readInt32LE(8);
        const payload = buffer.toString('utf-8', 12, 4 + size - 2);

        resolve({ id, type, payload });
      };

      const onError = () => {
        cleanup();
        resolve(null);
      };

      this.socket!.on('data', onData);
      this.socket!.once('error', onError);
    });
  }

  private buildPacket(id: number, type: number, payload: string): Buffer {
    const payloadBytes = Buffer.from(payload, 'utf-8');
    const data = Buffer.alloc(10 + payloadBytes.length);

    data.writeInt32LE(id, 0);
    data.writeInt32LE(type, 4);
    payloadBytes.copy(data, 8);

    const header = Buffer.alloc(4);
    header.writeInt32LE(10 + payloadBytes.length, 0);

    return Buffer.concat([header, data]);
  }

  isConnected(): boolean {
    return this.socket !== null && !this.socket.destroyed && this.socket.readyState === 'open';
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }
}
