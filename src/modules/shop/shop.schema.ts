import { z } from 'zod';

export const createItemSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  category: z.string().optional().default(''),
  description: z.string().optional().default(''),
  price: z.number().min(0),
  stock: z.number().int().min(-1).optional().default(-1),
  quality_max: z.number().int().min(1).max(5).optional().default(1),
  image_url: z.string().optional().default(''),
});

export const updateItemSchema = z.object({
  name: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  price: z.number().min(0).optional(),
  stock: z.number().int().min(-1).optional(),
  quality_max: z.number().int().min(1).max(5).optional(),
  is_active: z.number().int().min(0).max(1).optional(),
  image_url: z.string().optional(),
});

export const createOrderSchema = z.object({
  item_id: z.number().int().positive(),
  player_name: z.string().min(1),
  quantity: z.number().int().min(1).optional().default(1),
  quality_level: z.number().int().min(1).max(5).optional().default(1),
});

export const createOrderBatchSchema = z.object({
  items: z
    .array(
      z.object({
        item_id: z.number().int().positive(),
        quantity: z.number().int().min(1).optional().default(1),
        quality_level: z.number().int().min(1).max(5).optional().default(1),
      })
    )
    .min(1),
  player_name: z.string().min(1).optional(),
});

export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type CreateOrderBatchInput = z.infer<typeof createOrderBatchSchema>;

export const createItemRequestSchema = z.object({
  item_id: z.number().int().positive(),
  player_name: z.string().min(1, '请输入游戏角色名'),
  quantity: z.number().int().min(1).optional().default(1),
  quality_level: z.number().int().min(1).max(5).optional().default(1),
});

export type CreateItemRequestInput = z.infer<typeof createItemRequestSchema>;
