import { getDb } from '../../lib/database.js';
import { logger } from '../../lib/logger.js';
import * as repo from './chat.repository.js';
import * as vipRepo from '../vip/vip.repository.js';
import * as authRepo from '../auth/auth.repository.js';
import type { TriggerResponseInput, ServerResponseInput, PeriodicMessageInput, PlayerEventInput, FeatureToggleInput } from './chat.schema.js';
import { AppError } from '../../types/index.js';
import { sendGameCommand, fireAndForget } from '../../lib/game-command-bus.js';
import { getOnlinePlayers } from '../player/player.service.js';
import { recordEvent } from '../player/player.repository.js';
import { eventBus } from '../../lib/event-bus.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveConfigDir } from '../../lib/paths.js';
import { SERVER_NAME_CACHE_TTL } from '../../config/constants.js';
import * as voteService from '../vote/vote.service.js';

interface GiftItem {
  name: string;
  code: string;
  count: number;
  quality: string;
}

interface VipMessages {
  join_message: string;
  leave_message: string;
  first_join_message: string;
}

function parseVipMessages(featuresJson: string): VipMessages {
  const result: VipMessages = { join_message: '', leave_message: '', first_join_message: '' };
  try {
    const parsed = JSON.parse(featuresJson);
    if (Array.isArray(parsed)) {
      const msgObj = parsed.find((f: unknown): f is Record<string, unknown> => {
        if (typeof f !== 'object' || f === null) return false;
        const obj = f as Record<string, unknown>;
        return !!(obj.join_message || obj.leave_message || obj.first_join_message);
      });
      if (msgObj) {
        result.join_message = (msgObj.join_message as string) || '';
        result.leave_message = (msgObj.leave_message as string) || '';
        result.first_join_message = (msgObj.first_join_message as string) || '';
      }
    }
  } catch { /* ignore parse error */ }
  return result;
}

function getPlayerVipMessages(playerName: string): { vipMessages: VipMessages; globalSettings: Record<string, string> } {
  const db = getDb();
  const user = authRepo.findUserByUsername(db, playerName);
  const globalSettings = repo.getChatSettings(db);
  
  if (!user || user.vip_level <= 0) {
    return { vipMessages: { join_message: '', leave_message: '', first_join_message: '' }, globalSettings };
  }
  
  const now = Math.floor(Date.now() / 1000);
  if (user.vip_expiry && user.vip_expiry < now) {
    return { vipMessages: { join_message: '', leave_message: '', first_join_message: '' }, globalSettings };
  }
  
  const vipLevel = vipRepo.findLevelByLevel(db, user.vip_level);
  if (!vipLevel) {
    return { vipMessages: { join_message: '', leave_message: '', first_join_message: '' }, globalSettings };
  }
  
  return { vipMessages: parseVipMessages(vipLevel.features_json), globalSettings };
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
  const { vipMessages, globalSettings } = getPlayerVipMessages(playerName);
  const isFirstJoin = !repo.hasPlayerLoginEvent(db, playerName);

  recordEvent(playerName, 'login', {});

  const onlineCount = await getOnlinePlayersWithTimeout(ONLINE_PLAYERS_TIMEOUT_MS);

  if (isFirstJoin) {
    const firstJoinMsg = vipMessages.first_join_message || globalSettings.first_join_message;
    if (isEnabled(globalSettings.first_join_enabled) && firstJoinMsg) {
      const msg = replaceMessageVariables(firstJoinMsg, playerName, onlineCount);
      fireAndForget(`/shout ${msg}`);
    }
    if (isEnabled(globalSettings.first_gift_enabled) && globalSettings.first_gift_items) {
      try {
        const items: GiftItem[] = JSON.parse(globalSettings.first_gift_items);
        if (items.length > 0 && !repo.hasGiftClaim(db, playerName, 'first')) {
          await sendGiftItems(playerName, items);
          repo.addGiftClaim(db, playerName, 'first', globalSettings.first_gift_items);
        }
      } catch (e) { logger.warn({ err: e }, '[Chat] Send first-gift failed'); }
    }
  }

  const joinMsg = vipMessages.join_message || globalSettings.join_message;
  if (isEnabled(globalSettings.join_enabled) && joinMsg) {
    const msg = replaceMessageVariables(joinMsg, playerName, onlineCount);
    fireAndForget(`/shout ${msg}`);
  }

  if (!isFirstJoin && isEnabled(globalSettings.relogin_gift_enabled) && globalSettings.relogin_gift_items) {
    try {
      const items: GiftItem[] = JSON.parse(globalSettings.relogin_gift_items);
      if (items.length > 0) {
        const cooldownHours = parseInt(globalSettings.relogin_cooldown || '24', 10);
        const dailyLimit = parseInt(globalSettings.relogin_daily_limit || '1', 10);
        const totalLimit = parseInt(globalSettings.relogin_total_limit || '0', 10);

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
              repo.addGiftClaim(db, playerName, 'relogin', globalSettings.relogin_gift_items);
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
  const { vipMessages, globalSettings } = getPlayerVipMessages(playerName);

  recordEvent(playerName, 'logout', {});

  const leaveMsg = vipMessages.leave_message || globalSettings.leave_message;
  if (isEnabled(globalSettings.leave_enabled) && leaveMsg) {
    const playersOnline = await getOnlinePlayersWithTimeout(ONLINE_PLAYERS_TIMEOUT_MS);
    const onlineCount = Math.max(0, playersOnline - 1);
    const msg = replaceMessageVariables(leaveMsg, playerName, onlineCount);
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
    type: data.type ?? 'custom',
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

export function deleteTriggerResponsesBatch(ids: number[]): number {
  if (ids.length === 0) return 0;
  return repo.deleteTriggerResponsesByIds(getDb(), ids);
}

export function updateTriggerResponse(id: number, data: { trigger_text?: string; response_text?: string; case_sensitive?: number; enabled?: number }): boolean {
  const db = getDb();
  return repo.updateTriggerResponse(db, id, data);
}

export function getFeatureToggles() {
  return repo.getFeatureToggles(getDb());
}

export function updateFeatureToggle(featureKey: string, data: FeatureToggleInput): void {
  const db = getDb();
  const toggle = repo.getFeatureToggle(db, featureKey);
  if (!toggle) throw new AppError(`Feature '${featureKey}' not found`, 404);
  
  const ok = repo.updateFeatureToggle(db, featureKey, {
    enabled: data.enabled,
    keywords: data.keywords,
  });
  if (!ok) throw new AppError('Failed to update feature toggle', 500);
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

      const featureToggles = repo.getFeatureToggles(db);
      for (const feature of featureToggles) {
        if (!feature.enabled || !feature.keywords) continue;

        const keywords = feature.keywords.split(',').map(k => k.trim()).filter(Boolean);
        for (const keyword of keywords) {
          let isMatch = false;
          if (data.message.toLowerCase().includes(keyword.toLowerCase())) {
            isMatch = true;
          }

          if (isMatch) {
            switch (feature.feature_key) {
              case 'vote_kick':
                handleVoteKick(data.player, data.message, keyword);
                break;
              case 'server_info':
                handleServerInfo(data.player);
                break;
              case 'ping':
                handlePing(data.player);
                break;
              case 'restart_warning':
                handleRestartWarning();
                break;
              case 'item_request':
                handleItemRequest(data.player, data.message, keyword, '');
                break;
            }
            return;
          }
        }
      }

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

function extractLastWord(message: string, triggerText: string): string | null {
  const normalizedMessage = message.toLowerCase();
  const normalizedTrigger = triggerText.toLowerCase();
  const parts = message.split(/\s+/);
  
  for (let i = parts.length - 1; i >= 0; i--) {
    const candidate = parts[i].trim();
    if (candidate.length > 0 && !normalizedTrigger.includes(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return null;
}

function handleVoteKick(playerName: string, message: string, triggerText: string): void {
  try {
    const targetPlayer = extractLastWord(message, triggerText);
    if (!targetPlayer) {
      fireAndForget(`/shout @${playerName} 使用格式: ${triggerText} <玩家名称>`);
      return;
    }
    
    const db = getDb();
    const user = authRepo.findUserByUsername(db, playerName);
    const userId = user ? user.id : 0;
    
    voteService.startVote({ target: targetPlayer, type: 'kick', reason: '' }, userId);
    logger.info({ player: playerName, target: targetPlayer }, '[Chat Trigger] 已发起投票踢人');
  } catch (e: unknown) {
    const err = e as { message?: string };
    const errorMsg = err.message || '发起投票失败';
    fireAndForget(`/shout @${playerName} ${errorMsg}`);
    logger.error({ err, player: playerName }, '[Chat Trigger] 发起投票踢人失败');
  }
}

function handleServerInfo(playerName: string): void {
  try {
    const serverName = getServerName();
    fireAndForget(`/shout 服务器: ${serverName} | 时间: ${new Date().toLocaleString('zh-CN')}`);
    logger.info({ player: playerName }, '[Chat Trigger] 已发送服务器信息');
  } catch (e: unknown) {
    logger.error({ err: e, player: playerName }, '[Chat Trigger] 发送服务器信息失败');
  }
}

function handlePing(playerName: string): void {
  try {
    const startTime = Date.now();
    fireAndForget(`/shout @${playerName} Ping: ${Date.now() - startTime}ms`);
    logger.info({ player: playerName }, '[Chat Trigger] 已发送Ping响应');
  } catch (e: unknown) {
    logger.error({ err: e, player: playerName }, '[Chat Trigger] 发送Ping响应失败');
  }
}

function handleRestartWarning(): void {
  try {
    fireAndForget(`/shout [警告] 服务器将在30分钟后重启，请提前做好保存工作！`);
    logger.info('[Chat Trigger] 已发送重启警告');
  } catch (e: unknown) {
    logger.error({ err: e }, '[Chat Trigger] 发送重启警告失败');
  }
}

function handleItemRequest(playerName: string, message: string, triggerText: string, responseText: string): void {
  try {
    const itemCode = extractLastWord(message, triggerText);
    if (!itemCode) {
      fireAndForget(`/shout @${playerName} 使用格式: ${triggerText} <物品代码>`);
      return;
    }
    
    const command = responseText
      .replace(/\{player_name\}/g, playerName)
      .replace(/\{item_code\}/g, itemCode)
      .replace(/\{trigger_text\}/g, triggerText);
    
    fireAndForget(command);
    logger.info({ player: playerName, item: itemCode }, '[Chat Trigger] 已处理物品请求');
  } catch (e: unknown) {
    logger.error({ err: e, player: playerName }, '[Chat Trigger] 处理物品请求失败');
  }
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