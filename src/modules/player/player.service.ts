import { sendGameCommand } from '../../lib/game-command-bus.js';

export async function getOnlinePlayers(): Promise<string[]> {
  const result = await sendGameCommand('/players');

  if (!result.ok) return [];

  const players: string[] = [];
  const lines = result.value.split('\n');
  for (const line of lines) {
    const match = line.match(/^(\S+)\s+\(online\)/i);
    if (match) {
      players.push(match[1]);
    }
  }

  return players;
}

export async function kickPlayer(
  player: string,
  reason = ''
): Promise<string> {
  const cmd = reason ? `/kick ${player} ${reason}` : `/kick ${player}`;
  const result = await sendGameCommand(cmd);
  return result.ok ? result.value : '';
}

export async function banPlayer(
  player: string,
  reason = ''
): Promise<string> {
  const cmd = reason ? `/ban ${player} ${reason}` : `/ban ${player}`;
  const result = await sendGameCommand(cmd);
  return result.ok ? result.value : '';
}

export async function unbanPlayer(player: string): Promise<string> {
  const result = await sendGameCommand(`/unban ${player}`);
  return result.ok ? result.value : '';
}

export async function setAdmin(
  player: string,
  admin: boolean
): Promise<string> {
  const cmd = admin ? `/promote ${player}` : `/demote ${player}`;
  const result = await sendGameCommand(cmd);
  return result.ok ? result.value : '';
}

export async function setWhitelist(
  player: string,
  whitelist: boolean
): Promise<string> {
  const cmd = whitelist ? `/whitelist add ${player}` : `/whitelist remove ${player}`;
  const result = await sendGameCommand(cmd);
  return result.ok ? result.value : '';
}

export async function getWhitelist(): Promise<string[]> {
  const result = await sendGameCommand('/whitelist get');

  if (!result.ok) return [];

  return result.value
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export async function getAdmins(): Promise<string[]> {
  const result = await sendGameCommand('/admins');

  if (!result.ok) return [];

  return result.value
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('Admins:'));
}

export async function getBans(): Promise<string[]> {
  const result = await sendGameCommand('/bans');

  if (!result.ok) return [];

  return result.value
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export async function serverSave(): Promise<string> {
  const result = await sendGameCommand('/server-save');
  return result.ok ? result.value : '';
}

export async function serverQuit(): Promise<string> {
  const result = await sendGameCommand('/quit');
  return result.ok ? result.value : '';
}

export async function sendCommand(command: string): Promise<string> {
  const result = await sendGameCommand(command);
  return result.ok ? result.value : '';
}

export async function sayMessage(message: string): Promise<string> {
  const result = await sendGameCommand(`/shout ${message}`);
  return result.ok ? result.value : '';
}

export async function whisperMessage(
  player: string,
  message: string
): Promise<string> {
  const result = await sendGameCommand(`/w ${player} ${message}`);
  return result.ok ? result.value : '';
}

export async function giveItem(
  player: string,
  item: string,
  count = 1
): Promise<string> {
  const result = await sendGameCommand(`/give ${player} ${item} ${count}`);
  return result.ok ? result.value : '';
}