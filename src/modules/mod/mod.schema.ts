import { z } from 'zod';

export const modInstallSchema = z.object({
  mod_name: z.string().min(1, '模组名称不能为空'),
  version: z.string().optional(),
});

export const modUpdateSchema = z.object({
  mod_id: z.coerce.number().int().positive('模组ID必须为正整数').optional(),
  mod_name: z.string().optional(),
});

export const modToggleSchema = z.object({
  mod_id: z.coerce.number().int().positive('模组ID必须为正整数'),
  enabled: z.coerce.number().int().min(0).max(1, '启用状态必须为0或1'),
});

export const modUninstallSchema = z.object({
  mod_id: z.coerce.number().int().positive('模组ID必须为正整数'),
});

export const modCheckConflictsSchema = z.object({
  mod_ids: z.array(z.coerce.number().int().positive('模组ID必须为正整数')).min(1, '至少需要提供一个模组ID'),
});

export const modSearchQuerySchema = z.object({
  keyword: z.string().optional().default(''),
  query: z.string().optional().default(''),
  page: z.coerce.number().int().positive().optional().default(1),
});

export const modPortalSearchSchema = z.object({
  query: z.string().min(1, '搜索关键词不能为空'),
  page: z.coerce.number().int().positive().optional().default(1),
  page_size: z.coerce.number().int().min(1).max(50).optional().default(10),
  sort: z.enum(['top', 'new', 'updated']).optional().default('top'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const modInstallFromPortalSchema = z.object({
  mod_name: z.string().min(1, '模组名称不能为空'),
  version: z.string().optional(),
});

export type ModInstallInput = z.infer<typeof modInstallSchema>;
export type ModUpdateInput = z.infer<typeof modUpdateSchema>;
export type ModToggleInput = z.infer<typeof modToggleSchema>;
export type ModUninstallInput = z.infer<typeof modUninstallSchema>;
export type ModCheckConflictsInput = z.infer<typeof modCheckConflictsSchema>;
export type ModSearchQuery = z.infer<typeof modSearchQuerySchema>;
