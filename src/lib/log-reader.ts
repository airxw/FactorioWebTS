import { existsSync, statSync, createReadStream } from 'node:fs';
import { watch, type FSWatcher } from 'node:fs';
import { eventBus } from './event-bus.js';
import { logger } from './logger.js';
import { resolveLogPath } from './paths.js';
import { executeClaimCode } from '../modules/cdk/cdk.service.js';
import { fireAndForget } from './game-command-bus.js';

export class LogReader {
  private logFilePath: string = '';
  private logPosition: number = 0;
  private watcher: FSWatcher | null = null;
  private running: boolean = false;
  private readDebounceTimer: ReturnType<typeof setTimeout> | null = null;

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
      this.logPosition = stat.size;
      this.startWatching();
      logger.info({ logPath: this.logFilePath }, '日志流式监听已启动');
    } else {
      logger.info('日志文件不存在，等待服务器启动后自动激活');
    }
  }

  stop(): void {
    if (this.readDebounceTimer) {
      clearTimeout(this.readDebounceTimer);
      this.readDebounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.running = false;
  }

  reset(newLogPath: string): void {
    this.stop();

    this.logFilePath = newLogPath;
    this.logPosition = 0;

    if (existsSync(newLogPath)) {
      const stat = statSync(newLogPath);
      this.logPosition = stat.size;
    }

    this.running = true;
    this.startWatching();
    logger.info({ logPath: newLogPath, startPos: this.logPosition }, '日志流式监听已切换');
  }

  private startWatching(): void {
    if (!this.logFilePath) return;

    const tryWatch = () => {
      if (!this.logFilePath || !this.running) return;
      if (!existsSync(this.logFilePath)) {
        // 文件尚未创建，延迟重试
        setTimeout(tryWatch, 1000);
        return;
      }

      // 重连场景（如日志轮转后），从文件末尾开始，避免重读旧内容
      this.logPosition = statSync(this.logFilePath).size;

      try {
        this.watcher = watch(this.logFilePath, (eventType) => {
          if (eventType === 'change') {
            this.scheduleRead();
          } else if (eventType === 'rename') {
            // 文件被重命名（轮转），关闭旧 watcher，等待新文件出现
            if (this.watcher) {
              this.watcher.close();
              this.watcher = null;
            }
            setTimeout(tryWatch, 500);
          }
        });

        this.watcher.on('error', (err) => {
          logger.warn({ err }, '[LogReader] 文件监听错误，将在 1 秒后重试');
          if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
          }
          setTimeout(tryWatch, 1000);
        });
      } catch (e) {
        logger.warn({ err: e }, '[LogReader] 无法建立原生文件监听，将在 1 秒后重试');
        setTimeout(tryWatch, 1000);
      }
    };

    tryWatch();
  }

  private scheduleRead(): void {
    // 防抖：合并短时间内多次 change 事件为一次读取
    if (this.readDebounceTimer) {
      clearTimeout(this.readDebounceTimer);
    }
    this.readDebounceTimer = setTimeout(() => {
      this.readDebounceTimer = null;
      this.readNewLines();
    }, 50);
  }

  private readNewLines(): void {
    if (!this.logFilePath || !existsSync(this.logFilePath)) return;

    try {
      const stat = statSync(this.logFilePath);

      // 文件被截断（清空或变小），重置指针到 0 以读取新内容
      if (stat.size < this.logPosition) {
        this.logPosition = 0;
      }

      if (stat.size <= this.logPosition) return;

      const startPos = this.logPosition;
      const endPos = stat.size - 1;

      // 使用 ReadStream 流式读取追加的内容，防止大文件 split 导致内存暴涨
      const stream = createReadStream(this.logFilePath, {
        start: startPos,
        end: endPos,
        encoding: 'utf-8',
      });

      let remainingText = '';

      stream.on('data', (chunk: string | Buffer) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
        const lines = (remainingText + text).split('\n');
        // 最后一项可能是不完整的行，暂存到下一次
        remainingText = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) this.processLine(line);
        }
      });

      stream.on('end', () => {
        if (remainingText.trim()) {
          this.processLine(remainingText);
        }
        // 精准更新指针
        this.logPosition = stat.size;
      });

      stream.on('error', (err) => {
        logger.debug({ err }, '[LogReader] 读取追加日志流错误');
      });
    } catch (e) {
      logger.debug({ err: e }, '[LogReader] 读取追加日志失败');
    }
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
        if (chatData.message.startsWith('!claim ') || chatData.message.startsWith('!提货 ')) {
          const code = chatData.message.substring(chatData.message.indexOf(' ') + 1);
          executeClaimCode(chatData.player, code);
        } else if (chatData.message === '!claim' || chatData.message === '!提货') {
          fireAndForget(`/w ${chatData.player} 用法: !claim <提货码>`);
        }
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
