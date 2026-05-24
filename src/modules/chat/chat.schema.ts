import { z } from 'zod';

export const triggerResponseSchema = z.object({
  type: z.enum(['vote_kick', 'server_info', 'ping', 'restart_warning', 'item_request', 'custom']).optional().default('custom'),
  trigger_text: z.string().min(1),
  response_text: z.string().optional().default(''),
  case_sensitive: z.coerce.number().int().min(0).max(1).optional().default(0),
  enabled: z.coerce.number().int().min(0).max(1).optional().default(1),
});

export const serverResponseSchema = z.object({
  response_key: z.string().min(1),
  response_value: z.string().optional().default(''),
  response_type: z.string().optional().default('chat'),
  cooldown_seconds: z.coerce.number().int().min(0).optional().default(0),
});

export const periodicMessageSchema = z.object({
  type: z.string().optional().default('chat'),
  content: z.string().optional().default(''),
  item_code: z.string().optional().default(''),
  item_count: z.coerce.number().int().min(1).optional().default(1),
  interval_type: z.enum(['seconds', 'minutes', 'hours']).optional().default('minutes'),
  interval_value: z.coerce.number().int().min(1).optional().default(30),
  target: z.string().optional().default(''),
  enabled: z.coerce.number().int().min(0).max(1).optional().default(1),
});

export const chatSettingsSchema = z.object({
  settings: z.record(z.string(), z.unknown()).optional(),
});

export const playerEventSchema = z.object({
  event_type: z.string().min(1),
  enabled: z.coerce.number().int().min(0).max(1).optional().default(1),
  message: z.string().optional().default(''),
  target: z.string().optional().default(''),
});

export const featureToggleSchema = z.object({
  enabled: z.number().int().min(0).max(1),
  keywords: z.string().optional(),
});

export type TriggerResponseInput = z.infer<typeof triggerResponseSchema>;
export type ServerResponseInput = z.infer<typeof serverResponseSchema>;
export type PeriodicMessageInput = z.infer<typeof periodicMessageSchema>;
export type ChatSettingsInput = z.infer<typeof chatSettingsSchema>;
export type PlayerEventInput = z.infer<typeof playerEventSchema>;
export type FeatureToggleInput = z.infer<typeof featureToggleSchema>;
