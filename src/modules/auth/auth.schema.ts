import { z } from 'zod';

export const registerSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(6),
  name: z.string().optional().default(''),
  role: z.enum(['admin', 'user']).optional().default('user'),
});

export const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
  ip: z.string().optional().default(''),
});

export const changePasswordSchema = z.object({
  old_password: z.string().min(1),
  new_password: z.string().min(6),
});

export const updateNameSchema = z.object({
  name: z.string().min(1),
});

export const bindGameSchema = z.object({
  binding_code: z.string().min(1),
  game_id: z.string().min(1),
});

export const searchUsersSchema = z.object({
  keyword: z.string().optional().default(''),
});

export const createUserSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(6),
  name: z.string().optional().default(''),
  role: z.enum(['admin', 'user']).optional().default('user'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateNameInput = z.infer<typeof updateNameSchema>;
export type BindGameInput = z.infer<typeof bindGameSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
