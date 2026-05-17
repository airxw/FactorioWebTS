import { getRconPool } from '../../lib/rcon.js';

export async function getOnlinePlayers(): Promise<string[]> {
  const pool = getRconPool();
  const response = await pool.execute('/players');

  if (!response) return [];

  const players: string[] = [];
  const lines = response.split('\n');
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
  const pool = getRconPool();
  const cmd = reason ? `/kick ${player} ${reason}` : `/kick ${player}`;
  return pool.execute(cmd);
}

export async function banPlayer(
  player: string,
  reason = ''
): Promise<string> {
  const pool = getRconPool();
  const cmd = reason ? `/ban ${player} ${reason}` : `/ban ${player}`;
  return pool.execute(cmd);
}

export async function unbanPlayer(player: string): Promise<string> {
  const pool = getRconPool();
  return pool.execute(`/unban ${player}`);
}

export async function setAdmin(
  player: string,
  admin: boolean
): Promise<string> {
  const pool = getRconPool();
  if (admin) {
    return pool.execute(`/promote ${player}`);
  }
  return pool.execute(`/demote ${player}`);
}

export async function setWhitelist(
  player: string,
  whitelist: boolean
): Promise<string> {
  const pool = getRconPool();
  if (whitelist) {
    return pool.execute(`/whitelist add ${player}`);
  }
  return pool.execute(`/whitelist remove ${player}`);
}

export async function getWhitelist(): Promise<string[]> {
  const pool = getRconPool();
  const response = await pool.execute('/whitelist get');

  if (!response) return [];

  return response
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export async function getAdmins(): Promise<string[]> {
  const pool = getRconPool();
  const response = await pool.execute('/admins');

  if (!response) return [];

  return response
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('Admins:'));
}

export async function getBans(): Promise<string[]> {
  const pool = getRconPool();
  const response = await pool.execute('/bans');

  if (!response) return [];

  return response
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export async function serverSave(): Promise<string> {
  const pool = getRconPool();
  return pool.execute('/server-save');
}

export async function serverQuit(): Promise<string> {
  const pool = getRconPool();
  return pool.execute('/quit');
}

export async function sendCommand(command: string): Promise<string> {
  const pool = getRconPool();
  return pool.execute(command);
}

export async function sayMessage(message: string): Promise<string> {
  const pool = getRconPool();
  return pool.execute(`/say ${message}`);
}

export async function whisperMessage(
  player: string,
  message: string
): Promise<string> {
  const pool = getRconPool();
  return pool.execute(`/w ${player} ${message}`);
}

export async function giveItem(
  player: string,
  item: string,
  count = 1
): Promise<string> {
  const pool = getRconPool();
  return pool.execute(`/give ${player} ${item} ${count}`);
}
