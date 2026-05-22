import type { RconResult } from './rcon-types.js';
import { rconErr } from './rcon-types.js';
import { executeRconCommand, getRconManager } from './rcon-manager.js';
import { logger } from './logger.js';

export interface GameCommandBus {
  execute(command: string): Promise<RconResult<string>>;
  isServerReady(): boolean;
  allowedCommands(): string[];
}

const CRITICAL_COMMANDS = ['/quit', '/server-save', '/version'];
const CHAT_COMMANDS = ['/shout', '/s', '/w', '/whisper', '/reply', '/give'];

const FIRE_AND_FORGET_MAX_RETRIES = 10;
const FIRE_AND_FORGET_RETRY_DELAY_MS = 2000;

let serverRunning = false;
let serverStopping = false;

export function setServerRunningState(running: boolean, stopping: boolean): void {
  serverRunning = running;
  serverStopping = stopping;
}

export class RconCommandBus implements GameCommandBus {
  async execute(command: string): Promise<RconResult<string>> {
    const isCritical = CRITICAL_COMMANDS.some((cc) =>
      command.toLowerCase().startsWith(cc.toLowerCase())
    );
    const isChat = CHAT_COMMANDS.some((cc) =>
      command.toLowerCase().startsWith(cc.toLowerCase())
    );

    if (!serverRunning && !serverStopping && !isCritical) {
      if (isChat) {
        return executeRconCommand(command);
      }
      return rconErr('STATE_BLOCKED', `Server is not running, command blocked: ${command}`);
    }

    if (!serverRunning && serverStopping && !isCritical) {
      return rconErr('STATE_BLOCKED', `Server is stopping, non-critical command blocked: ${command}`);
    }

    return executeRconCommand(command);
  }

  isServerReady(): boolean {
    return serverRunning && getRconManager().isConnected();
  }

  allowedCommands(): string[] {
    if (serverRunning) return [];
    if (serverStopping) return CRITICAL_COMMANDS;
    return CRITICAL_COMMANDS;
  }
}

let instance: GameCommandBus | null = null;

export function setCommandBus(bus: GameCommandBus): void {
  instance = bus;
}

export function getCommandBus(): GameCommandBus {
  if (!instance) {
    instance = new RconCommandBus();
  }
  return instance;
}

export async function sendGameCommand(command: string): Promise<RconResult<string>> {
  return getCommandBus().execute(command);
}

export function fireAndForget(command: string): void {
  let attempt = 0;

  const trySend = () => {
    getCommandBus().execute(command).then((result) => {
      if (!result.ok) {
        const code = (result.error as { code?: string })?.code;
        if (code === 'STATE_BLOCKED') {
          logger.info({ command }, '[GameCommand] Fire-and-forget blocked by state guard');
        } else if ((code === 'NOT_CONNECTED' || code === 'DISCONNECTED') && attempt < FIRE_AND_FORGET_MAX_RETRIES) {
          attempt++;
          logger.info({ command, attempt, maxRetries: FIRE_AND_FORGET_MAX_RETRIES }, '[GameCommand] RCON not ready, retrying fire-and-forget');
          setTimeout(trySend, FIRE_AND_FORGET_RETRY_DELAY_MS);
        } else {
          logger.warn({ err: result.error, command, attempt }, '[GameCommand] Fire-and-forget failed after retries');
        }
      }
    });
  };

  trySend();
}