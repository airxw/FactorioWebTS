import { wsManager } from '../plugins/websocket.js';
import { logger } from './logger.js';
import { eventBus, type EventKey, type EventMap } from './event-bus.js';
import { logReader } from './log-reader.js';

type LogEventHandler = { event: EventKey; handler: (payload: any) => void };

const handlers: LogEventHandler[] = [];

function createHandler(type: string) {
  return (payload: any) => {
    wsManager.broadcast('log', { type, ...payload });
  };
}

export function startLogWatcher(): void {
  const entries: Array<{ event: EventKey; type: string }> = [
    { event: 'log:chat', type: 'chat' },
    { event: 'log:login', type: 'login' },
    { event: 'log:logout', type: 'logout' },
    { event: 'log:error', type: 'error' },
    { event: 'log:save', type: 'save' },
    { event: 'log:system', type: 'system' },
  ];

  for (const entry of entries) {
    const handler = createHandler(entry.type);
    eventBus.on(entry.event, handler);
    handlers.push({ event: entry.event, handler });
  }

  logReader.start();

  logger.info('日志广播已启动');
}

export function stopLogWatcher(): void {
  for (const { event, handler } of handlers) {
    eventBus.off(event, handler);
  }
  handlers.length = 0;

  logReader.stop();
}

export function resetLogWatcher(newLogPath: string): void {
  logReader.reset(newLogPath);
}
