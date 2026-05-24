import { z } from 'zod';

export const createVipLevelSchema = z.object({
  name: z.string().min(1),
  level: z.number().int().min(0),
  price: z.number().min(0),
  duration_days: z.number().int().min(1).optional().default(30),
  daily_purchase_limit: z.number().int().min(1).optional().default(5),
  single_purchase_limit: z.number().int().min(1).optional().default(10),
  max_quality_level: z.number().int().min(1).max(5).optional().default(1),
  features: z.array(z.any()).optional().default([]),
  sort_order: z.number().int().optional().default(0),
});

export const updateVipLevelSchema = z.object({
  name: z.string().min(1).optional(),
  price: z.number().min(0).optional(),
  duration_days: z.number().int().min(1).optional(),
  daily_purchase_limit: z.number().int().min(1).optional(),
  single_purchase_limit: z.number().int().min(1).optional(),
  max_quality_level: z.number().int().min(1).max(5).optional(),
  features: z.array(z.any()).optional(),
  sort_order: z.number().int().optional(),
  is_active: z.number().int().min(0).max(1).optional(),
});

export const setUserVipSchema = z.object({
  username: z.string().min(1, '请输入用户名'),
  vip_level: z.number().int().min(0),
  duration_days: z.number().int().min(1).optional(),
});

export type CreateVipLevelInput = z.infer<typeof createVipLevelSchema>;
export type UpdateVipLevelInput = z.infer<typeof updateVipLevelSchema>;
export type SetUserVipInput = z.infer<typeof setUserVipSchema>;
