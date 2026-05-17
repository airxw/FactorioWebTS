import { z } from 'zod';

export const versionUpgradeSchema = z.object({
  target_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  release_type: z.enum(['stable', 'experimental']).optional().default('stable'),
});

export type VersionUpgradeInput = z.infer<typeof versionUpgradeSchema>;
