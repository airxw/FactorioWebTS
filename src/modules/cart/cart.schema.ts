import { z } from 'zod';

export const cartItemSchema = z.object({
  item_id: z.number().int().positive(),
  quantity: z.number().int().min(1),
  quality_level: z.number().int().min(1).max(5).default(1),
});

export const cartSyncSchema = z.object({
  items: z.array(cartItemSchema),
});

export type CartItemInput = z.infer<typeof cartItemSchema>;
export type CartSyncInput = z.infer<typeof cartSyncSchema>;