import { z } from 'zod';

export const createSaveSchema = z.object({
  version: z.string(),
  save_name: z.string().optional(),
  seed: z.string().optional(),
  map_exchange_string: z.string().optional(),
});

export type CreateSaveInput = z.infer<typeof createSaveSchema>;
