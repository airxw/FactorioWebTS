import { z } from 'zod';

export const voteConfigSchema = z.object({
  pass_ratio: z.number().int().min(0).max(100).optional(),
  min_votes: z.number().int().min(1).optional(),
  cooldown_seconds: z.number().int().min(0).optional(),
});

export const startVoteSchema = z.object({
  target: z.string().min(1),
  reason: z.string().optional().default(''),
  type: z.enum(['kick']).optional().default('kick'),
});

export const castVoteSchema = z.object({
  vote_id: z.number().int().positive(),
  vote: z.enum(['yes', 'no']),
});

export const voteListQuerySchema = z.object({
  status: z.string().optional(),
  limit: z.coerce.number().int().positive().optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const banPlayerSchema = z.object({
  player_name: z.string().min(1),
  reason: z.string().optional().default(''),
});

export type VoteConfigInput = z.infer<typeof voteConfigSchema>;
export type StartVoteInput = z.infer<typeof startVoteSchema>;
export type CastVoteInput = z.infer<typeof castVoteSchema>;
export type VoteListQuery = z.infer<typeof voteListQuerySchema>;
export type BanPlayerInput = z.infer<typeof banPlayerSchema>;
