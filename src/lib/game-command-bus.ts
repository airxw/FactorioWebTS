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

let serverRunning = false;
let serverStopping = false;

export function setServerRunningState(running: boolean, stopping: boolean): void {
  serverRunning = running;
  serverStopping = stopping;
}

export class RconCommandBus implements GameCommandBus {
  async execute(command: string): Promise<RconResult<string>> {
    if (!serverRunning && !serverStopping) {
      return rconErr('STATE_BLOCKED', `Server is not running, command blocked: ${command}`);
    }

    if (serverStopping) {
      const isCritical = CRITICAL_COMMANDS.some((cc) =>
        command.toLowerCase().startsWith(cc.toLowerCase())
      );
      if (!isCritical) {
        logger.warn({ command }, '[GameCommand] Non-critical command blocked during server stop');
        return rconErr('STATE_BLOCKED', `Server is stopping, non-critical command blocked: ${command}`);
      }
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
  getCommandBus().execute(command).then((result) => {
    if (!result.ok) {
      const code = (result.error as { code?: string })?.code;
      if (code === 'STATE_BLOCKED') {
        logger.info({ command }, '[GameCommand] Fire-and-forget blocked by state guard');
      } else {
        logger.warn({ err: result.error, command }, '[GameCommand] Fire-and-forget failed');
      }
    }
  });
}