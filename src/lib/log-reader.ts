import { existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { eventBus } from './event-bus.js';
import { logger } from './logger.js';
import { LOG_POLL_INTERVAL } from '../config/constants.js';
import { resolveLogPath } from './paths.js';

export class LogReader {
  private logFilePath: string = '';
  private logPosition: number = 0;
  private lastIno: number = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: boolean = false;

  get currentLogPath(): string {
    return this.logFilePath;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    this.logFilePath = resolveLogPath();

    if (!this.logFilePath) {
      logger.warn('无法确定日志路径，日志读取将在服务器启动时自动激活');
      return;
    }

    if (existsSync(this.logFilePath)) {
      const stat = statSync(this.logFilePath);
      this.lastIno = stat.ino;
      this.logPosition = stat.size;
      this.timer = setInterval(() => this.checkLog(), LOG_POLL_INTERVAL);
      logger.info({ logPath: this.logFilePath }, '日志读取服务已启动');
    } else {
      logger.info('日志文件不存在，等待服务器启动后自动激活');
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  reset(newLogPath: string): void {
    this.stop();

    this.logFilePath = newLogPath;
    this.logPosition = 0;
    this.lastIno = 0;

    if (existsSync(newLogPath)) {
      const stat = statSync(newLogPath);
      this.lastIno = stat.ino;
      this.logPosition = stat.size;
    }

    this.running = true;
    this.timer = setInterval(() => this.checkLog(), LOG_POLL_INTERVAL);
    logger.info({ logPath: newLogPath }, '日志读取已切换');
  }

  private checkLog(): void {
    if (!this.logFilePath || !existsSync(this.logFilePath)) return;

    try {
      const st = statSync(this.logFilePath);

      if (st.ino !== this.lastIno) {
        this.logPosition = 0;
        this.lastIno = st.ino;
      }

      if (st.size <= this.logPosition) {
        this.logPosition = st.size;
        return;
      }

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
        this.processLine(line);
      }
    } catch (e) { logger.warn({ err: e }, '[LogReader] Failed to read log file'); }
  }

  private processLine(line: string): void {
    const time = this.parseLogLine(line);

    if (line.includes('[CHAT]')) {
      const chatData = this.parseChatLine(line);
      if (chatData) {
        eventBus.emit('log:chat', {
          player: chatData.player,
          message: chatData.message,
          raw: line,
          time,
        });
      }
    } else if (line.includes('joined the game')) {
      const playerName = this.parsePlayerNameFromEvent(line);
      if (playerName) {
        eventBus.emit('log:login', { playerName, raw: line, time });
        eventBus.emit('player:join', { playerName });
      }
    } else if (line.includes('left the game')) {
      const playerName = this.parsePlayerNameFromEvent(line);
      if (playerName) {
        eventBus.emit('log:logout', { playerName, raw: line, time });
        eventBus.emit('player:leave', { playerName });
      }
    } else if (line.includes('[ERROR]') || (/^\s*\d+\.\d+\s+Error\s/.test(line) && !line.includes('InterruptibleStdioStream'))) {
      eventBus.emit('log:error', { level: 'ERROR', message: line, raw: line, time });
    } else if (line.includes('[WARNING]') || /^\s*\d+\.\d+\s+Warning\s/.test(line)) {
      eventBus.emit('log:error', { level: 'WARN', message: line, raw: line, time });
    } else if (line.match(/Saving (game|map)/)) {
      eventBus.emit('log:save', { message: line, raw: line, time });
    } else {
      eventBus.emit('log:system', { message: line, raw: line, time });
    }
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

  private parsePlayerNameFromEvent(line: string): string | null {
    const joinMatch = line.match(/(\S+)\s+joined the game/);
    if (joinMatch) return joinMatch[1];

    const leaveMatch = line.match(/(\S+)\s+left the game/);
    if (leaveMatch) return leaveMatch[1];

    return null;
  }

  private parseLogLine(line: string): string {
    const timestampMatch = line.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
    return timestampMatch ? timestampMatch[1] : '';
  }
}

export const logReader = new LogReader();
