import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as service from './shop.service.js';
import * as repo from './shop.repository.js';
import { authenticate, requireAdmin } from '../../plugins/auth-guard.js';
import { getDb } from '../../lib/database.js';
import * as authRepo from '../auth/auth.repository.js';
import { logger } from '../../lib/logger.js';
import {
  createItemSchema,
  updateItemSchema,
  createOrderSchema,
  createOrderBatchSchema,
  createItemRequestSchema,
} from './shop.schema.js';

function getUserVipLevel(userId: number): number {
  const db = getDb();
  const user = authRepo.findUserById(db, userId);
  if (!user) return 0;

  const now = Math.floor(Date.now() / 1000);
  if (user.vip_expiry && user.vip_expiry < now) return 0;

  return user.vip_level || 0;
}

export default async function shopRoutes(app: FastifyInstance) {
  app.post('/api/shop/sync', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    try {
      const result = await service.syncFromGithub();
      return reply.send({ success: true, count: result.count, message: `成功同步 ${result.count} 个物品` });
    } catch (e) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/shop/items', async (request, reply) => {
    try {
      const { category } = request.query as { category?: string };
      const items = service.getItems(category);
      return reply.send({ success: true, data: items });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/shop/categories', async (_request, reply) => {
    try {
      const cats = service.getCategories();
      return reply.send({ success: true, data: cats });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/shop/items/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const item = service.getItemById(parseInt(id, 10));
      if (!item) return reply.status(404).send({ success: false, error: '商品不存在' });
      return reply.send({ success: true, data: item });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/shop/items', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = createItemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    }

    try {
      const item = service.createItem(parsed.data);
      return reply.status(201).send({ success: true, data: item });
    } catch (e) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.put('/api/shop/items/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateItemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    }

    try {
      const item = service.updateItem(parseInt(id, 10), parsed.data);
      return reply.send({ success: true, data: item });
    } catch (e) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.delete('/api/shop/items/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      service.deleteItem(parseInt(id, 10));
      return reply.send({ success: true, message: '删除成功' });
    } catch (e) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/shop/orders', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = createOrderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    }

    try {
      const userId = request.currentUser.user_id;
      const result = service.createOrder(userId, getUserVipLevel(userId), parsed.data);

      if (result.delivery_method === 'direct' && result.order_id) {
        const item = service.getItemById(parsed.data.item_id);
        if (item) {
          try {
            await service.deliverOrderDirect(result.order_id, result.player_name, item.code, parsed.data.quantity, parsed.data.quality_level);
          } catch (deliverErr) {
            logger.warn({ deliverErr, orderId: result.order_id }, '[Shop] Direct delivery failed');
          }
        }
      }

      return reply.status(201).send({
        success: true,
        data: {
          code: result.code,
          player_name: result.player_name,
          total_price: result.total_price,
          delivery_method: result.delivery_method,
        },
      });
    } catch (e) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/shop/orders/batch', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = createOrderBatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    }

    try {
      const userId = request.currentUser.user_id;
      const result = service.createBatchOrder(userId, getUserVipLevel(userId), parsed.data);

      if (result.delivery_method === 'direct') {
        const db = getDb();
        for (const orderEntry of result.orders) {
          const order = repo.findOrderById(db, orderEntry.order_id);
          if (order) {
            const item = repo.findItemById(db, order.item_id);
            if (item) {
              try {
                await service.deliverOrderDirect(orderEntry.order_id, result.player_name, item.code, order.quantity, order.quality_level);
              } catch (deliverErr) {
                logger.warn({ deliverErr, orderId: orderEntry.order_id }, '[Shop] Direct delivery failed for batch order');
              }
            }
          }
        }
      }

      const codes = result.orders.map(o => o.code).filter((c): c is string => !!c);
      return reply.status(201).send({
        success: true,
        data: { codes, player_name: result.player_name, total_price: result.total_price, item_count: result.orders.length, delivery_method: result.delivery_method },
      });
    } catch (e) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/shop/orders/my', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { status, search, page, pageSize } = request.query as { status?: string; search?: string; page?: string; pageSize?: string };
      const result = service.getMyOrders(request.currentUser.user_id, {
        status,
        search,
        page: page ? parseInt(page, 10) : 1,
        pageSize: pageSize ? parseInt(pageSize, 10) : 10,
      });

      const data = result.data.map((o) => ({
        order_id: o.id,
        order_number: o.order_number,
        item_name: o.item_name,
        item_code: o.item_code,
        category: o.item_category,
        player_name: o.player_name,
        quantity: o.quantity,
        total_price: o.total_price,
        status: o.status,
        quality_level: o.quality_level,
        delivery_method: o.delivery_method,
        cdk_code: o.cdk_code,
        created_at: o.created_at,
        delivered_at: o.delivered_at,
      }));

      return reply.send({ success: true, data, total: result.total, page: result.page, pageSize: result.pageSize });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/shop/orders/validate', async (request, reply) => {
    const { order_number } = (request.body as { order_number?: string }) || {};
    if (!order_number) {
      return reply.status(400).send({ success: false, error: '订单号不能为空' });
    }

    try {
      const order = service.validateOrder(order_number);
      if (!order) {
        return reply.send({ success: true, data: null });
      }

      return reply.send({
        success: true,
        data: {
          order_number: order.order_number,
          item_name: order.item_name,
          item_code: order.item_code,
          player_name: order.player_name,
          quantity: order.quantity,
          total_price: order.total_price,
          status: order.status,
          created_at: order.created_at,
        },
      });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/shop/orders/:id/cancel', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      service.cancelOrder(request.currentUser.user_id, parseInt(id, 10));
      return reply.send({ success: true, message: '订单已取消' });
    } catch (e) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/shop/orders/:id/deliver', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { player_name, rcon_command } = (request.body as { player_name?: string; rcon_command?: string }) || {};

    try {
      service.deliverOrder(parseInt(id, 10), player_name || '', rcon_command || '');
      return reply.send({ success: true, message: '订单已发货' });
    } catch (e) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.get('/api/shop/item-requests', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { status } = request.query as { status?: string };
    const requests = service.getItemRequests(status);

    const data = requests.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      name_cn: r.name_cn,
      requester: r.requester,
      status: r.status,
      quantity: r.quantity,
      quality_level: r.quality_level,
      created_at: r.created_at,
    }));

    return reply.send({ success: true, requests: data });
  });

  app.post('/api/shop/item-requests', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = createItemRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.errors[0].message });
    }

    try {
      const itemRequest = service.createItemRequest(request.currentUser.user_id, {
        item_id: parsed.data.item_id,
        requester: parsed.data.player_name,
        quantity: parsed.data.quantity,
        quality_level: parsed.data.quality_level,
      });
      return reply.status(201).send({ success: true, data: itemRequest });
    } catch (e) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/shop/item-requests/:id/approve', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      service.approveItemRequest(parseInt(id, 10));
      return reply.send({ success: true, message: '请求已批准' });
    } catch (e) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });

  app.post('/api/shop/item-requests/:id/reject', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      service.rejectItemRequest(parseInt(id, 10));
      return reply.send({ success: true, message: '请求已拒绝' });
    } catch (e) {
      const err = e as { statusCode?: number; message: string };
      return reply.status(err.statusCode || 500).send({ success: false, error: err.message });
    }
  });
}