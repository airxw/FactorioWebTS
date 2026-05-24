import { getDb } from '../../lib/database.js';
import { sendGameCommand, fireAndForget } from '../../lib/game-command-bus.js';
import { logger } from '../../lib/logger.js';
import * as repo from './cdk.repository.js';
import type { DbShopItem } from '../shop/shop.repository.js';
import type { DbVipLevel } from '../vip/vip.repository.js';

export function buildShopCommand(item: DbShopItem, quantity: number, quality_level: number, playerName: string): string {
  const qualityName = quality_level > 1 ? ` quality=${quality_level}` : '';
  return `/give ${playerName} ${item.code} ${quantity}${qualityName}`;
}

export function createShopCdk(
  userId: number,
  item: DbShopItem,
  quantity: number,
  quality_level: number,
  playerName: string
): string {
  const db = getDb();
  const code = repo.generateCode(db);
  const command = buildShopCommand(item, quantity, quality_level, '{player}');

  repo.createCode(db, {
    code,
    command,
    item_id: item.id,
    player_name: playerName,
    type: 'shop',
    user_id: userId,
  });

  logger.info({ code, item: item.code, quantity, playerName }, '[CDK] Shop CDK created');
  return code;
}

export function createBatchShopCdk(
  userId: number,
  items: Array<{ item: DbShopItem; quantity: number; quality_level: number }>,
  playerName: string
): string {
  const db = getDb();
  const code = repo.generateCode(db);
  const commands = items.map(function(e) {
    return buildShopCommand(e.item, e.quantity, e.quality_level, '{player}');
  });
  const command = commands.join('|||');

  repo.createCode(db, {
    code,
    command,
    item_id: null,
    player_name: playerName,
    type: 'shop',
    user_id: userId,
  });

  logger.info({ code, itemCount: items.length, playerName }, '[CDK] Batch Shop CDK created');
  return code;
}

export function createVipCdk(
  username: string,
  vipLevel: number,
  durationDays: number
): string {
  const db = getDb();
  const code = repo.generateCode(db);

  const now = Math.floor(Date.now() / 1000);
  const expiry = now + durationDays * 86400;

  const command = `/vip set {player} ${vipLevel} ${expiry}`;

  repo.createCode(db, {
    code,
    command,
    type: 'vip',
    user_id: null,
  });

  logger.info({ code, username, vipLevel, durationDays }, '[CDK] VIP CDK created');
  return code;
}

export async function executeClaimCode(playerName: string, cdkCode: string): Promise<void> {
  const db = getDb();

  const cdk = repo.findCodeByCode(db, cdkCode);

  if (!cdk || cdk.status !== 'UNUSED') {
    await sendGameCommand(`/w ${playerName} 提货失败：提货码无效或已被使用！`);
    return;
  }

  repo.updateCodeStatus(db, cdkCode, 'USED');

  const finalCommand = cdk.command.replace(/\{player\}/g, playerName);
  const commands = finalCommand.split('|||');

  logger.info({ playerName, cdkCode, commandCount: commands.length, commands }, '[CDK] Executing claim');

  let allOk = true;
  const succeededIndices: number[] = [];

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i].trim();
    if (!cmd) continue;
    const result = await sendGameCommand(cmd);
    if (result.ok) {
      succeededIndices.push(i);
    } else {
      allOk = false;
      logger.error({ playerName, cdkCode, cmd, err: result.error, index: i }, '[CDK] Command failed in batch');
      break;
    }
  }

  if (allOk) {
    if (cdk.type === 'vip') {
      await applyVipFromCode(playerName, cdk);
    }
    fireAndForget(`/w ${playerName} 提货成功！物品已发放到您的背包。`);
    logger.info({ playerName, cdkCode, type: cdk.type }, '[CDK] Claim success');
  } else {
    repo.updateCodeStatus(db, cdkCode, 'UNUSED');
    fireAndForget(`/w ${playerName} 发货失败，提货码已回滚，请稍后再试。`);
    logger.error({ playerName, cdkCode }, '[CDK] Claim failed, status rolled back');
  }
}

async function applyVipFromCode(playerName: string, cdk: repo.DbCdkCode): Promise<void> {
  const db = getDb();

  const user = db.prepare('SELECT id FROM users WHERE game_id = ? OR username = ?').get(playerName, playerName) as { id: number } | undefined;
  if (!user) {
    logger.warn({ playerName, cdkCode: cdk.code }, '[CDK] Cannot apply VIP: user not found in database');
    return;
  }

  const command = cdk.command.replace(/\{player\}/g, '');
  const parts = command.split(' ');
  const vipLevel = parseInt(parts[2], 10);
  const vipExpiry = parseInt(parts[3], 10);

  if (!isNaN(vipLevel) && !isNaN(vipExpiry)) {
    db.prepare('UPDATE users SET vip_level = ?, vip_expiry = ?, updated_at = ? WHERE id = ?').run(
      vipLevel,
      vipExpiry,
      Math.floor(Date.now() / 1000),
      user.id
    );
    logger.info({ playerName, vipLevel, vipExpiry }, '[CDK] VIP applied to user');
  }
}
