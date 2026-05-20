import { getDb } from './database.js';
import { getRconManager } from './rcon-manager.js';
import { logger } from './logger.js';
import { rconErr, rconOk, type RconResult } from './rcon-types.js';
import { getServerState, ServerState } from '../modules/server/server.service.js';

const QUEUE_POLL_INTERVAL_MS = 5000;
const COMMAND_PROCESS_DELAY_MS = 200;
const RETRY_DELAY_MS = 5000;

export interface DbPendingCommand {
  id: number;
  command: string;
  source: string;
  status: string;
  retry_count: number;
  max_retries: number;
  retry_after: number | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

export class CommandQueue {
  private timer: NodeJS.Timeout | null = null;
  private processing = false;
  private running = false;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => {
      if (!this.running) return;
      if (this.processing) return;
      this.processQueue();
    }, QUEUE_POLL_INTERVAL_MS);
    logger.info('[CommandQueue] 命令队列已启动');
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('[CommandQueue] 命令队列已停止');
  }

  enqueue(command: string, source = 'system'): number {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    const result = db.prepare(`
      INSERT INTO pending_commands (command, source, status, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, ?)
    `).run(command, source, now, now);
    logger.info({ id: result.lastInsertRowid, command, source }, '[CommandQueue] 命令已入队');
    return Number(result.lastInsertRowid);
  }

  async enqueueAndWait(command: string, source = 'manual', timeoutMs = 30000): Promise<RconResult<string>> {
    const commandId = this.enqueue(command, source);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const db = getDb();
      const row = db.prepare(
        'SELECT status, error_message FROM pending_commands WHERE id = ?'
      ).get(commandId) as { status: string; error_message: string | null } | undefined;

      if (!row) {
        return rconErr('NOT_FOUND', 'Command disappeared from queue');
      }

      if (row.status === 'delivered') {
        return rconOk('');
      }

      if (row.status === 'failed') {
        return rconErr('QUEUE_FAILED', row.error_message || 'Command failed in queue');
      }

      if (row.status === 'discarded') {
        return rconErr('DISCARDED', 'Command discarded (server not running or max retries exceeded)');
      }

      await new Promise((r) => setTimeout(r, 200));
    }

    return rconErr('TIMEOUT', `Command timed out after ${timeoutMs}ms in queue`);
  }

  fireAndForget(command: string, source = 'system'): void {
    this.enqueue(command, source);
  }

  discardStaleCommands(): number {
    const db = getDb();
    const result = db.prepare(`
      UPDATE pending_commands SET status = 'discarded', updated_at = ?
      WHERE status IN ('pending', 'failed') AND retry_count >= max_retries
    `).run(Math.floor(Date.now() / 1000));
    if (result.changes > 0) {
      logger.warn({ count: result.changes }, '[CommandQueue] 已丢弃达到最大重试次数的命令');
    }
    return result.changes;
  }

  getPendingCount(): number {
    const db = getDb();
    const row = db.prepare(
      "SELECT COUNT(*) as cnt FROM pending_commands WHERE status IN ('pending', 'failed', 'processing')"
    ).get() as { cnt: number };
    return row.cnt;
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      const serverState = getServerState().state;
      if (serverState !== ServerState.RUNNING) {
        this.discardNonCriticalCommands();
        return;
      }

      if (!getRconManager().isConnected()) {
        return;
      }

      await this.processNextBatch();
    } catch (e) {
      logger.warn({ err: e }, '[CommandQueue] 处理队列时出错');
    } finally {
      this.processing = false;
    }
  }

  private async processNextBatch(): Promise<void> {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    const commands = db.prepare(`
      SELECT * FROM pending_commands
      WHERE status IN ('pending', 'failed')
        AND (retry_after IS NULL OR retry_after <= ?)
        AND retry_count < max_retries
      ORDER BY created_at ASC
      LIMIT 10
    `).all(now) as DbPendingCommand[];

    for (const cmd of commands) {
      db.prepare(
        'UPDATE pending_commands SET status = ?, updated_at = ? WHERE id = ?'
      ).run('processing', now, cmd.id);

      const result = await getRconManager().sendCommand(cmd.command);

      if (result.ok) {
        db.prepare(
          'UPDATE pending_commands SET status = ?, updated_at = ? WHERE id = ?'
        ).run('delivered', Math.floor(Date.now() / 1000), cmd.id);
        logger.info({ id: cmd.id, command: cmd.command }, '[CommandQueue] 命令下发成功');
      } else {
        const newRetryCount = cmd.retry_count + 1;
        const newStatus = newRetryCount >= cmd.max_retries ? 'failed' : 'failed';
        const retryAfter = newRetryCount < cmd.max_retries
          ? Math.floor(Date.now() / 1000) + Math.floor(RETRY_DELAY_MS / 1000)
          : null;

        db.prepare(`
          UPDATE pending_commands
          SET status = ?, retry_count = ?, retry_after = ?, error_message = ?, updated_at = ?
          WHERE id = ?
        `).run(newStatus, newRetryCount, retryAfter, result.error.message, now, cmd.id);

        logger.warn(
          { id: cmd.id, command: cmd.command, retry: newRetryCount, max: cmd.max_retries, err: result.error.message },
          '[CommandQueue] 命令下发失败，将重试'
        );
      }

      await new Promise((r) => setTimeout(r, COMMAND_PROCESS_DELAY_MS));

      if (!getRconManager().isConnected()) {
        logger.warn('[CommandQueue] RCON 断开，暂停处理队列');
        return;
      }
    }
  }

  private discardNonCriticalCommands(): void {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    const result = db.prepare(`
      UPDATE pending_commands
      SET status = 'discarded', error_message = 'Server not running', updated_at = ?
      WHERE status IN ('pending', 'failed')
        AND source IN ('periodic', 'chat_reply', 'auto_response')
    `).run(now);

    if (result.changes > 0) {
      logger.warn({ count: result.changes }, '[CommandQueue] 已丢弃非关键命令（服务器未运行）');
    }
  }
}

export const commandQueue = new CommandQueue();
