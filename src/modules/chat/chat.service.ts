import { getDb } from '../../lib/database.js';
import * as repo from './chat.repository.js';
import type { TriggerResponseInput, ServerResponseInput, PeriodicMessageInput, PlayerEventInput } from './chat.schema.js';
import { AppError } from '../../types/index.js';
import { executeRconCommand } from '../../lib/rcon-pool.js';
import { getOnlinePlayers } from '../player/player.service.js';
import { recordEvent } from '../player/player.repository.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveConfigDir } from '../../lib/paths.js';

interface GiftItem {
  name: string;
  code: string;
  count: number;
  quality: string;
}

let cachedServerName: string | null = null;
let serverNameCacheTime = 0;
const SERVER_NAME_CACHE_TTL = 60000;

function getServerName(): string {
  const now = Date.now();
  if (cachedServerName !== null && now - serverNameCacheTime < SERVER_NAME_CACHE_TTL) {
    return cachedServerName;
  }
  try {
    const configDir = resolveConfigDir();
    const settingsPath = path.join(configDir, 'server-settings.json');
    if (existsSync(settingsPath)) {
      const raw = readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(raw);
      const name = settings.name || settings['name'];
      if (typeof name === 'string' && name.length > 0) {
        cachedServerName = name;
        serverNameCacheTime = now;
        return name;
      }
    }
  } catch {}
  cachedServerName = 'Factorio Server';
  serverNameCacheTime = now;
  return cachedServerName;
}

export function clearServerNameCache(): void {
  cachedServerName = null;
  serverNameCacheTime = 0;
}

function replaceMessageVariables(template: string, playerName: string, onlineCount: number): string {
  return template
    .replace(/\{player_name\}/g, playerName)
    .replace(/\{server_name\}/g, getServerName())
    .replace(/\{online_count\}/g, String(onlineCount));
}

function isEnabled(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (value === '1' || value === 1 || value === true) return true;
  if (typeof value === 'string' && value.toLowerCase() === 'true') return true;
  return false;
}

async function sendGiftItems(playerName: string, items: GiftItem[]): Promise<void> {
  for (const item of items) {
    const count = item.count || 1;
    let command = `/give ${playerName} ${item.code} ${count}`;
    if (item.quality && item.quality !== 'normal') {
      command += ` ${item.quality}`;
    }
    try {
      await executeRconCommand(command);
    } catch {}
  }
}

export async function processPlayerJoin(playerName: string): Promise<void> {
  const db = getDb();
  const settings = repo.getChatSettings(db);
  const isFirstJoin = !repo.hasPlayerLoginEvent(db, playerName);

  recordEvent(playerName, 'login', {});

  let onlineCount = 0;
  try {
    const players = await getOnlinePlayers();
    onlineCount = players.length;
  } catch {}

  if (isFirstJoin) {
    if (isEnabled(settings.first_join_enabled) && settings.first_join_message) {
      const msg = replaceMessageVariables(settings.first_join_message, playerName, onlineCount);
      try { await executeRconCommand(`/say ${msg}`); } catch (e) { console.error('[Chat] 发送首次加入消息失败:', e); }
    }
    if (isEnabled(settings.first_gift_enabled) && settings.first_gift_items) {
      try {
        const items: GiftItem[] = JSON.parse(settings.first_gift_items);
        if (items.length > 0 && !repo.hasGiftClaim(db, playerName, 'first')) {
          await sendGiftItems(playerName, items);
          repo.addGiftClaim(db, playerName, 'first', settings.first_gift_items);
        }
      } catch (e) { console.error('[Chat] 发送首次礼包失败:', e); }
    }
  } else {
    if (isEnabled(settings.join_enabled) && settings.join_message) {
      const msg = replaceMessageVariables(settings.join_message, playerName, onlineCount);
      try { await executeRconCommand(`/say ${msg}`); } catch (e) { console.error('[Chat] 发送加入消息失败:', e); }
    }
  }

  if (!isFirstJoin && isEnabled(settings.relogin_gift_enabled) && settings.relogin_gift_items) {
    try {
      const items: GiftItem[] = JSON.parse(settings.relogin_gift_items);
      if (items.length > 0) {
        const cooldownHours = parseInt(settings.relogin_cooldown || '24', 10);
        const dailyLimit = parseInt(settings.relogin_daily_limit || '1', 10);
        const totalLimit = parseInt(settings.relogin_total_limit || '0', 10);

        const lastClaimTime = repo.getLastGiftClaimTime(db, playerName, 'relogin');
        const now = Math.floor(Date.now() / 1000);
        const cooldownSeconds = cooldownHours * 3600;

        if (now - lastClaimTime >= cooldownSeconds) {
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const todayTimestamp = Math.floor(todayStart.getTime() / 1000);
          const todayCount = repo.countGiftClaimsSince(db, playerName, 'relogin', todayTimestamp);

          if (todayCount < dailyLimit) {
            if (totalLimit === 0 || repo.countGiftClaimsTotal(db, playerName, 'relogin') < totalLimit) {
              await sendGiftItems(playerName, items);
              repo.addGiftClaim(db, playerName, 'relogin', settings.relogin_gift_items);
            }
          }
        }
      }
    } catch (e) { console.error('[Chat] 发送回归礼包失败:', e); }
  }
}

export async function processPlayerLeave(playerName: string): Promise<void> {
  const db = getDb();
  const settings = repo.getChatSettings(db);

  recordEvent(playerName, 'logout', {});

  if (isEnabled(settings.leave_enabled) && settings.leave_message) {
    let onlineCount = 0;
    try {
      const players = await getOnlinePlayers();
      onlineCount = Math.max(0, players.length - 1);
    } catch {}
    const msg = replaceMessageVariables(settings.leave_message, playerName, onlineCount);
    try { await executeRconCommand(`/say ${msg}`); } catch (e) { console.error('[Chat] 发送离开消息失败:', e); }
  }
}
export function getChatSettings(): Record<string, string> {
  return repo.getChatSettings(getDb());
}

export function saveChatSettings(settings: Record<string, unknown>): void {
  const db = getDb();
  const txn = db.transaction(() => {
    for (const [key, value] of Object.entries(settings)) {
      repo.upsertChatSetting(db, key, String(value));
    }
  });
  txn();
}

export function listTriggerResponses() {
  return repo.listTriggerResponses(getDb());
}

export function addTriggerResponse(data: TriggerResponseInput) {
  return repo.addTriggerResponse(getDb(), {
    trigger_text: data.trigger_text,
    response_text: data.response_text ?? '',
    case_sensitive: data.case_sensitive ?? 0,
    enabled: data.enabled ?? 1,
  });
}

export function deleteTriggerResponse(id: number): void {
  const ok = repo.deleteTriggerResponse(getDb(), id);
  if (!ok) throw new AppError('触发器不存在', 404);
}

export function updateTriggerResponse(id: number, data: { trigger_text?: string; response_text?: string; case_sensitive?: number; enabled?: number }): boolean {
  const db = getDb();
  return repo.updateTriggerResponse(db, id, data);
}

export function listServerResponses() {
  return repo.listServerResponses(getDb());
}

export function saveServerResponse(data: ServerResponseInput) {
  repo.upsertServerResponse(getDb(), {
    response_key: data.response_key,
    response_value: data.response_value ?? '',
    response_type: data.response_type ?? 'chat',
    cooldown_seconds: data.cooldown_seconds ?? 0,
  });
}

export function deleteServerResponse(response_key: string): void {
  const ok = repo.deleteServerResponse(getDb(), response_key);
  if (!ok) throw new AppError('响应不存在', 404);
}

export function listPeriodicMessages() {
  return repo.listPeriodicMessages(getDb());
}

export function addPeriodicMessage(data: PeriodicMessageInput) {
  return repo.addPeriodicMessage(getDb(), {
    type: data.type ?? 'chat',
    content: data.content ?? '',
    item_code: data.item_code ?? '',
    item_count: data.item_count ?? 1,
    interval_type: data.interval_type ?? 'minutes',
    interval_value: data.interval_value ?? 30,
    target: data.target ?? '',
    enabled: data.enabled ?? 1,
  });
}

export function updatePeriodicMessage(id: number, data: Partial<PeriodicMessageInput>): void {
  const ok = repo.updatePeriodicMessage(getDb(), id, data);
  if (!ok) throw new AppError('周期消息不存在', 404);
}

export function deletePeriodicMessage(id: number): void {
  const ok = repo.deletePeriodicMessage(getDb(), id);
  if (!ok) throw new AppError('周期消息不存在', 404);
}

export function togglePeriodicMessage(id: number, enabled: number): void {
  const ok = repo.togglePeriodicMessage(getDb(), id, enabled);
  if (!ok) throw new AppError('周期消息不存在', 404);
}

export function getPlayerEvents() {
  return repo.getPlayerEvents(getDb());
}

export function savePlayerEvent(data: PlayerEventInput) {
  repo.upsertPlayerEvent(getDb(), {
    event_type: data.event_type,
    enabled: data.enabled ?? 1,
    message: data.message ?? '',
    target: data.target ?? '',
  });
}
