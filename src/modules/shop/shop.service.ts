import { getDb } from '../../lib/database.js';
import * as repo from './shop.repository.js';
import type { DbShopItem, DbOrder, DbItemRequest } from './shop.repository.js';
import type {
  CreateItemInput,
  UpdateItemInput,
  CreateOrderInput,
  CreateOrderBatchInput,
} from './shop.schema.js';
import { AppError } from '../../types/index.js';
const GITHUB_ITEMS_URL = 'https://raw.githubusercontent.com/airxw/factorioitem/main/items.json';

interface ItemsData {
  [category: string]: {
    [code: string]: string;
  };
}

const qualityMultipliers: Record<number, number> = {
  1: 1,
  2: 1.5,
  3: 2,
  4: 3,
  5: 5,
};

const vipConfigs: Record<
  number,
  { daily_purchase_limit: number; single_purchase_limit: number; max_quality_level: number }
> = {
  0: { daily_purchase_limit: 5, single_purchase_limit: 10, max_quality_level: 1 },
  1: { daily_purchase_limit: 10, single_purchase_limit: 20, max_quality_level: 1 },
  2: { daily_purchase_limit: 15, single_purchase_limit: 30, max_quality_level: 2 },
  3: { daily_purchase_limit: 20, single_purchase_limit: 50, max_quality_level: 3 },
  4: { daily_purchase_limit: 30, single_purchase_limit: 100, max_quality_level: 4 },
};

function checkVipLimits(
  user: { vip_level?: number; id?: number },
  item: DbShopItem,
  quantity: number,
  quality: number
): { allowed: boolean; reason?: string } {
  const vipLevel = user.vip_level ?? 0;
  const config = vipConfigs[vipLevel] ?? vipConfigs[0];

  if (quantity > config.single_purchase_limit) {
    return {
      allowed: false,
      reason: `VIP${vipLevel} 单次最多购买 ${config.single_purchase_limit} 件`,
    };
  }

  if (quality > config.max_quality_level) {
    return {
      allowed: false,
      reason: `VIP${vipLevel} 不能购买品质等级高于 ${config.max_quality_level} 的物品`,
    };
  }

  if (user.id) {
    const db = getDb();
    const todayCount = repo.countUserOrdersToday(db, user.id);
    if (todayCount >= config.daily_purchase_limit) {
      return {
        allowed: false,
        reason: `VIP${vipLevel} 每日购买上限 ${config.daily_purchase_limit} 已用完`,
      };
    }
  }

  return { allowed: true };
}

// 分类映射：将数据库中的中文分类映射为前端期望的英文分类
const categoryMap: Record<string, string> = {
  '装备': 'equipment',
  '消耗品': 'other',
  '弹药': 'other',
  '物流': 'logistics',
  '生产': 'production',
  '战斗': 'combat',
  '中间品': 'intermediate',
  '太空时代': 'space-age'
};

const reverseCategoryMap: Record<string, string> = {};
for (const [key, value] of Object.entries(categoryMap)) {
  if (!reverseCategoryMap[value]) {
    reverseCategoryMap[value] = key;
  }
}

export interface TransformedShopItem extends Omit<DbShopItem, 'is_active' | 'quality_max'> {
  name_cn: string;
  enabled: boolean;
  quality_level: number;
  category: string;
}

function transformItem(item: DbShopItem): TransformedShopItem {
  return {
    ...item,
    name_cn: item.name,
    enabled: item.is_active === 1,
    quality_level: item.quality_max,
    category: categoryMap[item.category] || item.category
  };
}

export function getItems(category?: string): TransformedShopItem[] {
  const db = getDb();
  const dbCategory = category ? (reverseCategoryMap[category] || category) : undefined;
  const items = repo.findAllItems(db, dbCategory ? { category: dbCategory } : undefined);
  return items.map(transformItem);
}

export function getCategories(): string[] {
  const db = getDb();
  const cats = repo.getCategories(db);
  return cats.map(c => categoryMap[c] || c);
}

export function getItemById(id: number): TransformedShopItem | null {
  const db = getDb();
  const item = repo.findItemById(db, id);
  return item ? transformItem(item) : null;
}

export function createItem(data: CreateItemInput): DbShopItem {
  const db = getDb();
  const id = repo.createItem(db, {
    name_cn: data.name,
    name_en: data.code,
    ...data,
  });
  return repo.findItemById(db, id)!;
}

export function updateItem(
  id: number,
  data: UpdateItemInput
): DbShopItem {
  const db = getDb();
  const existing = repo.findItemById(db, id);
  if (!existing) throw new AppError('商品不存在', 404);
  repo.updateItem(db, id, data);
  return repo.findItemById(db, id)!;
}

export function deleteItem(id: number): void {
  const db = getDb();
  const exists = repo.findItemById(db, id);
  if (!exists) throw new AppError('商品不存在', 404);
  repo.deleteItem(db, id);
}

export function createOrder(
  userId: number,
  userVipLevel: number,
  data: CreateOrderInput
): { order: DbOrder; item: DbShopItem } {
  const db = getDb();

  const item = repo.findItemById(db, data.item_id);
  if (!item) throw new AppError('商品不存在', 404);
  if (!item.is_active) throw new AppError('商品已下架', 400);
  if (item.stock !== -1 && item.stock < data.quantity) {
    throw new AppError('库存不足', 400);
  }

  const vipCheck = checkVipLimits(
    { vip_level: userVipLevel, id: userId },
    item,
    data.quantity,
    data.quality_level
  );
  if (!vipCheck.allowed) {
    throw new AppError(vipCheck.reason!, 400);
  }

  const multiplier = qualityMultipliers[data.quality_level] ?? 1;
  const totalPrice = item.price * data.quantity * multiplier;

  const orderId = repo.createOrder(db, {
    user_id: userId,
    item_id: data.item_id,
    player_name: data.player_name,
    quantity: data.quantity,
    total_price: Math.round(totalPrice * 100) / 100,
    quality_level: data.quality_level,
  });

  const order = repo.findOrderById(db, orderId)!;
  return { order, item };
}

export function createBatchOrder(
  userId: number,
  userVipLevel: number,
  data: CreateOrderBatchInput
): Array<{ order: DbOrder; item: DbShopItem }> {
  const db = getDb();

  const validated: Array<{
    item: DbShopItem;
    quantity: number;
    quality_level: number;
    totalPrice: number;
  }> = [];

  for (const entry of data.items) {
    const item = repo.findItemById(db, entry.item_id);
    if (!item) throw new AppError(`商品 ${entry.item_id} 不存在`, 404);
    if (!item.is_active) throw new AppError(`商品 ${item.name} 已下架`, 400);
    if (item.stock !== -1 && item.stock < entry.quantity) {
      throw new AppError(`商品 ${item.name} 库存不足`, 400);
    }

    const vipCheck = checkVipLimits(
      { vip_level: userVipLevel, id: userId },
      item,
      entry.quantity,
      entry.quality_level
    );
    if (!vipCheck.allowed) {
      throw new AppError(vipCheck.reason!, 400);
    }

    const multiplier = qualityMultipliers[entry.quality_level] ?? 1;
    validated.push({
      item,
      quantity: entry.quantity,
      quality_level: entry.quality_level,
      totalPrice: Math.round(item.price * entry.quantity * multiplier * 100) / 100,
    });
  }

  const results: Array<{ order: DbOrder; item: DbShopItem }> = [];
  for (const v of validated) {
    const orderId = repo.createOrder(db, {
      user_id: userId,
      item_id: v.item.id,
      player_name: data.player_name || '',
      quantity: v.quantity,
      total_price: v.totalPrice,
      quality_level: v.quality_level,
    });
    results.push({ order: repo.findOrderById(db, orderId)!, item: v.item });
  }

  return results;
}

export function getMyOrders(
  userId: number,
  status?: string
): Array<DbOrder & { item_name: string; item_code: string; item_category: string }> {
  const db = getDb();
  return repo.findOrdersWithItems(db, { userId, status, limit: 50 });
}

export function validateOrder(
  orderNumber: string
): (DbOrder & { item_name: string; item_code: string }) | null {
  const db = getDb();
  const order = repo.findOrderByNumber(db, orderNumber);
  if (!order) return null;

  const item = repo.findItemById(db, order.item_id);
  return {
    ...order,
    item_name: item?.name ?? 'Unknown',
    item_code: item?.code ?? 'Unknown',
  };
}

export function cancelOrder(userId: number, orderId: number): void {
  const db = getDb();
  const order = repo.findOrderById(db, orderId);
  if (!order) throw new AppError('订单不存在', 404);
  if (order.user_id !== userId)
    throw new AppError('无权操作此订单', 403);
  if (order.status !== 'pending')
    throw new AppError('只能取消待处理的订单', 400);

  repo.updateOrderStatus(db, orderId, 'cancelled');
}

export function deliverOrder(
  orderId: number,
  player: string,
  rconCmd: string
): void {
  const db = getDb();
  const order = repo.findOrderById(db, orderId);
  if (!order) throw new AppError('订单不存在', 404);
  if (order.status !== 'pending')
    throw new AppError('订单已处理', 400);

  repo.updateOrderStatus(db, orderId, 'delivered', {
    delivered_to_player: player,
    delivered_at: Math.floor(Date.now() / 1000),
    rcon_command: rconCmd,
  });
}

export async function syncFromGithub(): Promise<{ count: number }> {
  const response = await fetch(GITHUB_ITEMS_URL);
  if (!response.ok) {
    throw new AppError(`从GitHub获取物品数据失败: ${response.statusText}`, 500);
  }
  const itemsData: ItemsData = await response.json();

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  let count = 0;
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM shop_items').run();
    db.prepare("DELETE FROM sqlite_sequence WHERE name = 'shop_items'").run();

    const insertStmt = db.prepare(`
      INSERT INTO shop_items (name, name_cn, name_en, code, category, description, price, stock, quality_max, is_active, image_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, -1, 1, 1, ?, ?, ?)
    `);

    for (const [category, items] of Object.entries(itemsData)) {
      for (const [code, nameCn] of Object.entries(items)) {
        let displayName = nameCn;
        const nameEn = code;
        let nameCnValue = nameCn;

        if (nameCn === code) {
          nameCnValue = code.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          displayName = nameCnValue;
        }

        insertStmt.run(
          displayName,
          nameCnValue,
          nameEn,
          code,
          category,
          '',
          '',
          now,
          now
        );
        count++;
      }
    }
  });

  transaction();
  return { count: count };
}

export function createItemRequest(
  userId: number,
  data: {
    item_id: number;
    requester: string;
    quantity: number;
    quality_level: number;
  }
): DbItemRequest {
  const db = getDb();
  const item = repo.findItemById(db, data.item_id);
  if (!item) throw new AppError('商品不存在', 404);
  if (!item.is_active) throw new AppError('商品已下架', 400);

  const id = repo.createItemRequest(db, {
    user_id: userId,
    item_id: data.item_id,
    code: item.code,
    name: item.name,
    name_cn: item.name_cn,
    requester: data.requester,
    quantity: data.quantity,
    quality_level: data.quality_level,
  });

  return repo.findItemRequestById(db, id)!;
}

export function getItemRequests(status?: string): DbItemRequest[] {
  const db = getDb();
  return repo.findItemRequests(db, { status });
}

export function approveItemRequest(id: number): void {
  const db = getDb();
  const request = repo.findItemRequestById(db, id);
  if (!request) throw new AppError('请求不存在', 404);
  if (request.status !== 'pending')
    throw new AppError('只能批准待处理的请求', 400);

  repo.updateItemRequestStatus(db, id, 'approved');
}

export function rejectItemRequest(id: number): void {
  const db = getDb();
  const request = repo.findItemRequestById(db, id);
  if (!request) throw new AppError('请求不存在', 404);
  if (request.status !== 'pending')
    throw new AppError('只能拒绝待处理的请求', 400);

  repo.updateItemRequestStatus(db, id, 'rejected');
}
