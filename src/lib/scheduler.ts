import { getDb } from './database.js';
import { executeRconCommand } from './rcon-pool.js';
import { resolveLogPath } from './paths.js';
import type {
  DbPeriodicMessage,
  DbTriggerResponse} from '../modules/chat/chat.repository.js';
import {
  listPeriodicMessages,
  listTriggerResponses,
} from '../modules/chat/chat.repository.js';
import { processPlayerJoin, processPlayerLeave } from '../modules/chat/chat.service.js';
import { existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';

interface PeriodicMessageState {
  id: number;
  intervalMs: number;
  lastSent: number;
}

export class Scheduler {
  private timers: NodeJS.Timeout[] = [];
  private running = false;
  private periodicStates: Map<number, PeriodicMessageState> = new Map();
  private logPosition = 0;
  private logFilePath = '';

  start(): void {
    if (this.running) return;
    this.running = true;

    this.logFilePath = resolveLogPath();

    this.startPeriodicMessages();
    this.startChatLogMonitor();
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];
    this.periodicStates.clear();
  }

  private startPeriodicMessages(): void {
    const timer = setInterval(() => {
      if (!this.running) return;
      this.processPeriodicMessages();
    }, 1000);
    this.timers.push(timer);
  }

  private processPeriodicMessages(): void {
    let messages: DbPeriodicMessage[];
    try {
      const db = getDb();
      messages = listPeriodicMessages(db).filter((m) => m.enabled === 1);
    } catch {
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
    try {
      let command: string;
      if (msg.type === 'give') {
        command = `/give ${msg.target} ${msg.item_code} ${msg.item_count}`;
      } else {
        command = `/say ${msg.content}`;
      }
      await executeRconCommand(command);
    } catch {
      // RCON may be unavailable; silently ignore
    }
  }

  private startChatLogMonitor(): void {
    this.initLogPosition();

    const timer = setInterval(() => {
      if (!this.running) return;
      this.checkLogForNewChat();
    }, 5000);
    this.timers.push(timer);
  }

  private initLogPosition(): void {
    try {
      if (existsSync(this.logFilePath)) {
        const st = statSync(this.logFilePath);
        this.logPosition = st.size;
      }
    } catch {
      // Log file may not exist yet
    }
  }

  private checkLogForNewChat(): void {
    let triggers: DbTriggerResponse[];
    try {
      const db = getDb();
      triggers = listTriggerResponses(db).filter((t) => t.enabled === 1);
    } catch {
      return;
    }

    try {
      if (!existsSync(this.logFilePath)) return;

      const st = statSync(this.logFilePath);
      if (st.size < this.logPosition) {
        this.logPosition = 0;
      }
      if (st.size <= this.logPosition) return;

      const bytesToRead = st.size - this.logPosition;
      const buffer = Buffer.alloc(bytesToRead);

      let fd: number | undefined;
      try {
        fd = openSync(this.logFilePath, 'r');
        readSync(fd, buffer, 0, bytesToRead, this.logPosition);
      } finally {
        if (fd !== undefined) closeSync(fd);
      }

      this.logPosition = st.size;

      const content = buffer.toString('utf-8');
      const lines = content.split('\n').filter((l) => l.trim());

      for (const line of lines) {
        if (line.includes('[CHAT]')) {
          if (triggers.length === 0) continue;
          const chatData = this.parseChatLine(line);
          if (!chatData) continue;
          this.matchAndRespond(chatData.player, chatData.message, triggers);
        } else if (line.includes('joined the game')) {
          const playerName = this.parsePlayerNameFromEvent(line);
          if (playerName) {
            processPlayerJoin(playerName);
          }
        } else if (line.includes('left the game')) {
          const playerName = this.parsePlayerNameFromEvent(line);
          if (playerName) {
            processPlayerLeave(playerName);
          }
        }
      }
    } catch {
      // Silently handle file read errors
    }
  }

  private parsePlayerNameFromEvent(line: string): string | null {
    const joinMatch = line.match(/(\S+)\s+joined the game/);
    if (joinMatch) return joinMatch[1];

    const leaveMatch = line.match(/(\S+)\s+left the game/);
    if (leaveMatch) return leaveMatch[1];

    return null;
  }

  private parseChatLine(line: string): { player: string; message: string } | null {
    const chatIndex = line.indexOf('[CHAT]');
    if (chatIndex === -1) return null;

    const afterChat = line.substring(chatIndex + 6).trim();

    const angleMatch = afterChat.match(/^<([^>]+)>\s*(.*)/);
    if (angleMatch) {
      return { player: angleMatch[1], message: angleMatch[2] };
    }

    const colonMatch = afterChat.match(/^([^:]+):\s*(.*)/);
    if (colonMatch) {
      return { player: colonMatch[1], message: colonMatch[2] };
    }

    return null;
  }

  private async matchAndRespond(
    player: string,
    chatMessage: string,
    triggers: DbTriggerResponse[],
  ): Promise<void> {
    for (const trigger of triggers) {
      const matched =
        trigger.case_sensitive === 1
          ? chatMessage.includes(trigger.trigger_text)
          : chatMessage.toLowerCase().includes(trigger.trigger_text.toLowerCase());

      if (!matched) continue;

      const response = trigger.response_text.replace(/\{player\}/g, player);
      try {
        if (response.startsWith('/w ') || response.startsWith('/whisper ')) {
          await executeRconCommand(response);
        } else {
          await executeRconCommand(`/w ${player} ${response}`);
        }
      } catch {
        // RCON may be unavailable
      }
      break;
    }
  }
}

export const scheduler = new Scheduler();