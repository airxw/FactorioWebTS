import type { RconResult } from './rcon-types.js';
import { executeRconCommand } from './rcon-manager.js';
import { logger } from './logger.js';

export interface GameCommandBus {
  execute(command: string): Promise<RconResult<string>>;
}

export class RconCommandBus implements GameCommandBus {
  async execute(command: string): Promise<RconResult<string>> {
    return executeRconCommand(command);
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
      logger.warn({ err: result.error, command }, '[GameCommand] Fire-and-forget failed');
    }
  });
}