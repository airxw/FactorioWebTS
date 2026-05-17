import { z } from 'zod';

export const configSaveSchema = z.object({
  file_type: z.string().min(1),
  content: z.string(),
  version: z.string().optional(),
});

export const configTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(''),
  config: z.string().optional().default('{}'),
  config_type: z.string().optional().default(''),
  created_by: z.string().optional().default(''),
});

export const configTemplateApplySchema = z.object({
  template_id: z.coerce.number().int().positive(),
  target_save: z.string().optional(),
});

export type ConfigSaveInput = z.infer<typeof configSaveSchema>;
export type ConfigTemplateInput = z.infer<typeof configTemplateSchema>;
export type ConfigTemplateApplyInput = z.infer<typeof configTemplateApplySchema>;
