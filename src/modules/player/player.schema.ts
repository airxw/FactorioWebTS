import { z } from 'zod';

export const kickPlayerSchema = z.object({
  player: z.string().min(1),
  reason: z.string().optional().default(''),
});

export const banPlayerSchema = z.object({
  player: z.string().min(1),
  reason: z.string().optional().default(''),
});

export const unbanPlayerSchema = z.object({
  player: z.string().min(1),
});

export const setAdminSchema = z.object({
  player: z.string().min(1),
  admin: z.boolean(),
});

export const setWhitelistSchema = z.object({
  player: z.string().min(1),
  whitelist: z.boolean(),
});

export type KickPlayerInput = z.infer<typeof kickPlayerSchema>;
export type BanPlayerInput = z.infer<typeof banPlayerSchema>;
export type UnbanPlayerInput = z.infer<typeof unbanPlayerSchema>;
export type SetAdminInput = z.infer<typeof setAdminSchema>;
export type SetWhitelistInput = z.infer<typeof setWhitelistSchema>;
