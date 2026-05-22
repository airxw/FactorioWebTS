import { getDb } from './database.js';
import { sendGameCommand } from './game-command-bus.js';
import { logger } from './logger.js';
import type { DbPeriodicMessage, DbTriggerResponse } from '../modules/chat/chat.repository.js';
import { listPeriodicMessages, listTriggerResponses } from '../modules/chat/chat.repository.js';
import { SCHEDULER_PERIODIC_INTERVAL } from '../config/constants.js';
import { eventBus, type EventKey, type EventMap } from './event-bus.js';
import { getServerState, ServerState } from '../modules/server/server.service.js';

interface PeriodicMessageState {
  id: number;
  intervalMs: number;
  lastSent: number;
}

type EventHandler = { event: EventKey; handler: (payload: any) => void };

export class Scheduler {
  private timers: NodeJS.Timeout[] = [];
  private running = false;
  private periodicStates: Map<number, PeriodicMessageState> = new Map();
  private eventHandlers: EventHandler[] = [];

  start(): void {
    if (this.running) return;
    this.running = true;

    this.startPeriodicMessages();
    this.subscribeToEvents();
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];
    this.periodicStates.clear();

    for (const { event, handler } of this.eventHandlers) {
      eventBus.off(event, handler);
    }
    this.eventHandlers = [];
  }

  private subscribeToEvents(): void {
    const chatHandler = (payload: EventMap['log:chat']) => {
      this.handleChatEvent(payload);
    };
    eventBus.on('log:chat', chatHandler);
    this.eventHandlers.push({ event: 'log:chat', handler: chatHandler });
  }

  private async handleChatEvent(data: { player: string; message: string }): Promise<void> {
    // 仅在服务器 RUNNING 状态下响应，避免 STARTING/STOPPING 阶段发送无效指令
    const { state } = getServerState();
    if (state !== ServerState.RUNNING) return;

    let triggers: DbTriggerResponse[];
    try {
      const db = getDb();
      triggers = listTriggerResponses(db).filter((t) => t.enabled === 1);
    } catch (e) {
      logger.warn({ err: e }, '[Scheduler] Failed to load trigger responses');
      return;
    }

    if (triggers.length === 0) return;

    for (const trigger of triggers) {
      const matched =
        trigger.case_sensitive === 1
          ? data.message.includes(trigger.trigger_text)
          : data.message.toLowerCase().includes(trigger.trigger_text.toLowerCase());

      if (!matched) continue;

      const response = trigger.response_text.replace(/\{player\}/g, data.player);
      const cmd = response.startsWith('/w ') || response.startsWith('/whisper ')
        ? response
        : `/w ${data.player} ${response}`;

      const result = await sendGameCommand(cmd);
      if (!result.ok) {
        const code = (result.error as { code?: string })?.code;
        if (code === 'STATE_BLOCKED') {
          return;
        }
        logger.warn({ response, player: data.player, err: result.error }, '[Scheduler] Auto-response failed');
      }
      break;
    }
  }

  private startPeriodicMessages(): void {
    const timer = setInterval(() => {
      if (!this.running) return;
      this.processPeriodicMessages();
    }, SCHEDULER_PERIODIC_INTERVAL);
    this.timers.push(timer);
  }

  private processPeriodicMessages(): void {
    let messages: DbPeriodicMessage[];
    try {
      const db = getDb();
      messages = listPeriodicMessages(db).filter((m) => m.enabled === 1);
    } catch (e) {
      logger.warn({ err: e }, '[Scheduler] Failed to load periodic messages');
      return;
    }

    const now = Date.now();

    for (const msg of messages) {
      let state = this.periodicStates.get(msg.id);
      if (!state) {
        const intervalMs = this.getIntervalMs(msg.interval_type, msg.interval_value);
        state = { id: msg.id, intervalMs, lastSent: 0 };
        this.periodicStates.set(msg.id, state);
      }

      state.intervalMs = this.getIntervalMs(msg.interval_type, msg.interval_value);

      if (now - state.lastSent >= state.intervalMs) {
        this.sendPeriodicMessage(msg);
        state.lastSent = now;
      }
    }

    const activeIds = new Set(messages.map((m) => m.id));
    for (const id of this.periodicStates.keys()) {
      if (!activeIds.has(id)) {
        this.periodicStates.delete(id);
      }
    }
  }

  private getIntervalMs(type: string, value: number): number {
    switch (type) {
      case 'seconds':
        return value * 1000;
      case 'minutes':
        return value * 60 * 1000;
      case 'hours':
        return value * 60 * 60 * 1000;
      default:
        return 30 * 1000;
    }
  }

  private async sendPeriodicMessage(msg: {
    type: string;
    content: string;
    item_code: string;
    item_count: number;
    target: string;
  }): Promise<void> {
    // 仅在服务器 RUNNING 状态下发送，避免 STARTING/STOPPING 阶段发送无效指令
    const { state } = getServerState();
    if (state !== ServerState.RUNNING) return;

    let command: string;
    if (msg.type === 'give') {
      command = `/give ${msg.target} ${msg.item_code} ${msg.item_count}`;
    } else {
      command = `/shout ${msg.content}`;
    }

    const result = await sendGameCommand(command);
    if (!result.ok) {
      const code = (result.error as { code?: string })?.code;
      if (code === 'STATE_BLOCKED') {
        return;
      }
      logger.warn({ command, err: result.error }, '[Scheduler] Periodic message send failed');
    }
  }
}

export const scheduler = new Scheduler();
