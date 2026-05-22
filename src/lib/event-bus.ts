import { EventEmitter } from 'node:events';

export interface EventMap {
  'player:join': { playerName: string };
  'player:leave': { playerName: string };
  'config:server-settings-changed': {};
  'log:chat': { player: string; message: string; raw: string; time: string };
  'log:history-chat': { player: string; message: string; raw: string; time: string };
  'log:login': { playerName: string; message: string; raw: string; time: string };
  'log:logout': { playerName: string; message: string; raw: string; time: string };
  'log:error': { level: string; message: string; raw: string; time: string };
  'log:save': { message: string; raw: string; time: string };
  'log:system': { message: string; raw: string; time: string };
}

export type EventKey = keyof EventMap;

export class TypedEventBus extends EventEmitter {
  on<K extends EventKey>(event: K, listener: (payload: EventMap[K]) => void): this {
    return super.on(event, listener);
  }

  off<K extends EventKey>(event: K, listener: (payload: EventMap[K]) => void): this {
    return super.off(event, listener);
  }

  emit<K extends EventKey>(event: K, payload: EventMap[K]): boolean {
    return super.emit(event, payload);
  }
}

export const eventBus = new TypedEventBus();
