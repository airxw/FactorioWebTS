import { getDb } from '../../lib/database.js';
import { logger } from '../../lib/logger.js';
import * as repo from './chat.repository.js';
import type { TriggerResponseInput, ServerResponseInput, PeriodicMessageInput, PlayerEventInput } from './chat.schema.js';
import { AppError } from '../../types/index.js';
import { sendGameCommand, fireAndForget } from '../../lib/game-command-bus.js';
import { getOnlinePlayers } from '../player/player.service.js';
import { recordEvent } from '../player/player.repository.js';
import { eventBus } from '../../lib/event-bus.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveConfigDir } from '../../lib/paths.js';
import { SERVER_NAME_CACHE_TTL } from '../../config/constants.js';

interface GiftItem {
  name: string;
  code: string;
  count: number;
  quality: string;
}

let cachedServerName: string | null = null;
let serverNameCacheTime = 0;

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
  } catch (e) { logger.warn({ err: e }, '[Chat] Failed to read server-settings.json for server name'); }
  cachedServerName = 'Factorio Server';
  serverNameCacheTime = now;
  return cachedServerName;
}

function clearServerNameCache(): void {
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

const GIFT_ITEM_DELAY_MS = 300;

async function sendGiftItems(playerName: string, items: GiftItem[]): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const count = item.count || 1;
    let command = `/give ${playerName} ${item.code} ${count}`;
    if (item.quality && item.quality !== 'normal') {
      command += ` ${item.quality}`;
    }
    fireAndForget(command);
    if (i < items.length - 1) {
      await new Promise(r => setTimeout(r, GIFT_ITEM_DELAY_MS));
    }
  }
}

async function getOnlinePlayersWithTimeout(timeoutMs: number): Promise<number> {
  try {
    const result = await Promise.race([
      getOnlinePlayers(),
      new Promise<string[]>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return result.length;
  } catch (e) {
    logger.warn({ err: e }, '[Chat] Failed to get online players (timeout/RCON)');
    return 0;
  }
}

const ONLINE_PLAYERS_TIMEOUT_MS = 3000;
const JOIN_DEBOUNCE_MS = 2000;

const joinDebounceMap = new Map<string, ReturnType<typeof setTimeout>>();

async function processPlayerJoin(playerName: string): Promise<void> {
  if (joinDebounceMap.has(playerName)) {
    clearTimeout(joinDebounceMap.get(playerName));
    joinDebounceMap.delete(playerName);
    return;
  }
  joinDebounceMap.set(playerName, setTimeout(() => {
    joinDebounceMap.delete(playerName);
  }, JOIN_DEBOUNCE_MS));

  const db = getDb();
  const settings = repo.getChatSettings(db);
  const isFirstJoin = !repo.hasPlayerLoginEvent(db, playerName);

  recordEvent(playerName, 'login', {});

  const onlineCount = await getOnlinePlayersWithTimeout(ONLINE_PLAYERS_TIMEOUT_MS);

  if (isFirstJoin) {
    if (isEnabled(settings.first_join_enabled) && settings.first_join_message) {
      const msg = replaceMessageVariables(settings.first_join_message, playerName, onlineCount);
      fireAndForget(`/shout ${msg}`);
    }
    if (isEnabled(settings.first_gift_enabled) && settings.first_gift_items) {
      try {
        const items: GiftItem[] = JSON.parse(settings.first_gift_items);
        if (items.length > 0 && !repo.hasGiftClaim(db, playerName, 'first')) {
          await sendGiftItems(playerName, items);
          repo.addGiftClaim(db, playerName, 'first', settings.first_gift_items);
        }
      } catch (e) { logger.warn({ err: e }, '[Chat] Send first-gift failed'); }
    }
  }

  if (isEnabled(settings.join_enabled) && settings.join_message) {
    const msg = replaceMessageVariables(settings.join_message, playerName, onlineCount);
    fireAndForget(`/shout ${msg}`);
  }

  if (!isFirstJoin && isEnabled(settings.relogin_gift_enabled) && settings.relogin_gift_items) {
    try {
      const items: GiftItem[] = JSON.parse(settings.relogin_gift_items);
      if (items.length > 0) {
        const cooldownHours = parseInt(settings.relogin_cooldown || '24', 10);
        const dailyLimit = parseInt(settings.relogin_daily_limit || '1', 10);
        const totalLimit = parseInt(settings.relogin_total_limit || '0', 10);

        const lastLogoutTime = repo.getLastLogoutTime(db, playerName);
        const now = Math.floor(Date.now() / 1000);
        const cooldownSeconds = cooldownHours * 3600;

        const isEligible = lastLogoutTime > 0 && (now - lastLogoutTime) >= cooldownSeconds;

        if (cooldownHours === 0 || isEligible) {
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const todayTimestamp = Math.floor(todayStart.getTime() / 1000);
          const todayCount = repo.countGiftClaimsSince(db, playerName, 'relogin', todayTimestamp);

          if (dailyLimit === 0 || todayCount < dailyLimit) {
            if (totalLimit === 0 || repo.countGiftClaimsTotal(db, playerName, 'relogin') < totalLimit) {
              await sendGiftItems(playerName, items);
              repo.addGiftClaim(db, playerName, 'relogin', settings.relogin_gift_items);
            }
          }
        }
      }
    } catch (e) { logger.warn({ err: e }, '[Chat] Send relogin gift failed'); }
  }
}

const leaveDebounceMap = new Map<string, ReturnType<typeof setTimeout>>();

async function processPlayerLeave(playerName: string): Promise<void> {
  if (leaveDebounceMap.has(playerName)) {
    clearTimeout(leaveDebounceMap.get(playerName));
    leaveDebounceMap.delete(playerName);
    return;
  }
  leaveDebounceMap.set(playerName, setTimeout(() => {
    leaveDebounceMap.delete(playerName);
  }, JOIN_DEBOUNCE_MS));

  const db = getDb();
  const settings = repo.getChatSettings(db);

  recordEvent(playerName, 'logout', {});

  if (isEnabled(settings.leave_enabled) && settings.leave_message) {
    const playersOnline = await getOnlinePlayersWithTimeout(ONLINE_PLAYERS_TIMEOUT_MS);
    const onlineCount = Math.max(0, playersOnline - 1);
    const msg = replaceMessageVariables(settings.leave_message, playerName, onlineCount);
    fireAndForget(`/shout ${msg}`);
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
  if (!ok) throw new AppError('Trigger not found', 404);
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
  if (!ok) throw new AppError('Response not found', 404);
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
  if (!ok) throw new AppError('Periodic message not found', 404);
}

export function deletePeriodicMessage(id: number): void {
  const ok = repo.deletePeriodicMessage(getDb(), id);
  if (!ok) throw new AppError('Periodic message not found', 404);
}

export function togglePeriodicMessage(id: number, enabled: number): void {
  const ok = repo.togglePeriodicMessage(getDb(), id, enabled);
  if (!ok) throw new AppError('Periodic message not found', 404);
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

export function initChatEventSubscriptions(): void {
  eventBus.on('player:join', (data) => {
    processPlayerJoin(data.playerName).catch(err => {
      logger.error({ err, playerName: data.playerName }, '[Chat] processPlayerJoin failed');
    });
  });
  eventBus.on('player:leave', (data) => {
    processPlayerLeave(data.playerName).catch(err => {
      logger.error({ err, playerName: data.playerName }, '[Chat] processPlayerLeave failed');
    });
  });
  eventBus.on('log:chat', (data) => {
    logger.debug({ player: data.player, message: data.message }, '[Chat] 收到聊天消息');

    try {
      const db = getDb();
      const triggers = repo.listTriggerResponses(db);

      for (const trigger of triggers) {
        if (!trigger.enabled) continue;

        let isMatch = false;
        if (trigger.case_sensitive) {
          isMatch = data.message.includes(trigger.trigger_text);
        } else {
          isMatch = data.message.toLowerCase().includes(trigger.trigger_text.toLowerCase());
        }

        if (isMatch && trigger.response_text) {
          const replyMsg = trigger.response_text
            .replace(/\{player_name\}/g, data.player)
            .replace(/\{trigger_text\}/g, trigger.trigger_text);

          fireAndForget(`/shout ${replyMsg}`);
          logger.info({ player: data.player, trigger: trigger.trigger_text }, '[Chat Trigger] 已自动回复');
          break;
        }
      }
    } catch (err) {
      logger.error({ err }, '[Chat Trigger] 自动回复执行失败');
    }
  });
  eventBus.on('config:server-settings-changed', () => {
    clearServerNameCache();
  });
}

export function listFirstJoinPlayers() {
  return repo.listFirstJoinPlayers(getDb());
}

export function resetFirstJoinPlayer(playerName: string): { deleted_events: number; deleted_gifts: number } {
  if (!playerName || typeof playerName !== 'string' || playerName.trim().length === 0) {
    throw new AppError('玩家名称不能为空', 400);
  }
  const db = getDb();
  return repo.resetFirstJoinPlayer(db, playerName.trim());
}