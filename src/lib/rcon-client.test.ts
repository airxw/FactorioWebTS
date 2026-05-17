import { describe, it, expect } from 'vitest';

const SERVERDATA_AUTH = 3;
const SERVERDATA_RESPONSE_VALUE = 0;

function buildPacket(id: number, type: number, payload: string): Buffer {
  const payloadBytes = Buffer.from(payload, 'utf-8');
  const data = Buffer.alloc(10 + payloadBytes.length);

  data.writeInt32LE(id, 0);
  data.writeInt32LE(type, 4);
  payloadBytes.copy(data, 8);

  const header = Buffer.alloc(4);
  header.writeInt32LE(10 + payloadBytes.length, 0);

  return Buffer.concat([header, data]);
}

function parsePacket(buffer: Buffer): {
  id: number;
  type: number;
  payload: string;
} | null {
  if (buffer.length < 14) return null;

  const size = buffer.readInt32LE(0);
  if (size < 10 || buffer.length < 4 + size) return null;

  const id = buffer.readInt32LE(4);
  const type = buffer.readInt32LE(8);
  const payload = buffer.toString('utf-8', 12, 4 + size - 2);

  return { id, type, payload };
}

describe('RCON Protocol', () => {
  describe('packet building', () => {
    it('should build an auth packet with correct structure', () => {
      const packet = buildPacket(1, SERVERDATA_AUTH, 'test123');

      expect(packet.length).toBe(4 + 10 + 'test123'.length);

      const size = packet.readInt32LE(0);
      expect(size).toBe(10 + 'test123'.length);

      const id = packet.readInt32LE(4);
      expect(id).toBe(1);

      const type = packet.readInt32LE(8);
      expect(type).toBe(SERVERDATA_AUTH);

      const payload = packet.toString('utf-8', 12, packet.length - 2);
      expect(payload).toBe('test123');
    });

    it('should build an empty command packet', () => {
      const packet = buildPacket(5, 2, '');

      const size = packet.readInt32LE(0);
      expect(size).toBe(10);

      const id = packet.readInt32LE(4);
      expect(id).toBe(5);
    });

    it('should handle packets with special characters', () => {
      const command = '/kick player "hello world"';
      const packet = buildPacket(3, 2, command);

      const size = packet.readInt32LE(0);
      expect(size).toBe(10 + Buffer.from(command, 'utf-8').length);
    });

    it('should handle UTF-8 payloads', () => {
      const command = '/say 你好世界';
      const packet = buildPacket(2, 2, command);

      const payload = packet.toString('utf-8', 12, packet.length - 2);
      expect(payload).toBe(command);
    });
  });

  describe('packet parsing', () => {
    it('should parse a complete packet', () => {
      const packet = buildPacket(7, SERVERDATA_RESPONSE_VALUE, 'response data');
      const parsed = parsePacket(packet);

      expect(parsed).not.toBeNull();
      expect(parsed!.id).toBe(7);
      expect(parsed!.type).toBe(SERVERDATA_RESPONSE_VALUE);
      expect(parsed!.payload).toBe('response data');
    });

    it('should return null for incomplete packets', () => {
      const buf = Buffer.alloc(8);
      buf.writeInt32LE(100, 0);
      const parsed = parsePacket(buf);
      expect(parsed).toBeNull();
    });

    it('should return null for packets smaller than minimum size', () => {
      const buf = Buffer.alloc(4);
      buf.writeInt32LE(5, 0);
      const parsed = parsePacket(buf);
      expect(parsed).toBeNull();
    });

    it('should parse a packet with numeric payload', () => {
      const packet = buildPacket(1, 0, '');
      const parsed = parsePacket(packet);

      expect(parsed).not.toBeNull();
      expect(parsed!.payload).toBe('');
    });

    it('should parse auth response correctly', () => {
      const packet = buildPacket(1, 2, '');
      const parsed = parsePacket(packet);

      expect(parsed).not.toBeNull();
      expect(parsed!.id).toBe(1);
      expect(parsed!.type).toBe(2);
    });

    it('should identify failed auth (id=-1)', () => {
      const packet = buildPacket(-1, 2, '');
      const parsed = parsePacket(packet);

      expect(parsed).not.toBeNull();
      expect(parsed!.id).toBe(-1);
    });
  });

  describe('packet roundtrip', () => {
    it('should preserve data after build and parse cycle', () => {
      const testCases = [
        { id: 1, type: 3, payload: 'secret' },
        { id: 42, type: 0, payload: 'Online players (1):\nplayer1' },
        { id: 100, type: 2, payload: '' },
        { id: -1, type: 2, payload: '' },
        { id: 7, type: 0, payload: '{"key":"value"}' },
      ];

      for (const tc of testCases) {
        const built = buildPacket(tc.id, tc.type, tc.payload);
        const parsed = parsePacket(built);

        expect(parsed, `failed for ${JSON.stringify(tc)}`).not.toBeNull();
        expect(parsed!.id).toBe(tc.id);
        expect(parsed!.type).toBe(tc.type);
        expect(parsed!.payload).toBe(tc.payload);
      }
    });
  });

  describe('edge cases', () => {
    it('should handle very large payload', () => {
      const largePayload = 'x'.repeat(4000);
      const packet = buildPacket(1, 0, largePayload);
      const parsed = parsePacket(packet);

      expect(parsed).not.toBeNull();
      expect(parsed!.payload).toBe(largePayload);
    });

    it('should maintain correct size in header', () => {
      const payloads = ['', 'a', 'ab', 'abc', 'hello world', '你好世界'];

      for (const payload of payloads) {
        const packet = buildPacket(1, 0, payload);
        const size = packet.readInt32LE(0);
        const expectedSize = 10 + Buffer.from(payload, 'utf-8').length;

        expect(size).toBe(expectedSize);
      }
    });
  });
});
