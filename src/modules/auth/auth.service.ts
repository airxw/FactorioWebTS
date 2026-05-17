import bcrypt from 'bcrypt';
import { getDb } from '../../lib/database.js';
import * as repo from './auth.repository.js';
import type { DbUser } from './auth.repository.js';
import type {
  RegisterInput,
  LoginInput,
  ChangePasswordInput,
  CreateUserInput,
} from './auth.schema.js';
import { loadEnv } from '../../config/env.js';
import { AppError } from '../../types/index.js';
export type SanitizedUser = Omit<DbUser, 'password_hash'>;

function getBcryptCost(): number {
  return loadEnv().BCRYPT_COST;
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, getBcryptCost());
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function sanitizeUser(user: DbUser): SanitizedUser {
  const { password_hash: _password_hash, ...rest } = user;
  return rest;
}

function requireUser(user: DbUser | null): DbUser {
  if (!user) throw new Error('User not found');
  return user;
}

export function register(data: RegisterInput): DbUser {
  const db = getDb();

  if (repo.userExists(db, data.username)) {
    throw new AppError('用户名已存在', 409);
  }

  const passwordHash = hashPassword(data.password);
  const userId = repo.createUser(db, {
    username: data.username,
    password_hash: passwordHash,
    name: data.name || '',
    role: data.role || 'user',
  });

  return requireUser(repo.findUserById(db, userId));
}

export function login(data: LoginInput): DbUser {
  const db = getDb();

  const user = repo.findUserByUsername(db, data.username);
  if (!user) {
    throw new AppError('用户名或密码错误', 401);
  }

  if (!verifyPassword(data.password, user.password_hash)) {
    throw new AppError('用户名或密码错误', 401);
  }

  repo.updateLastLogin(db, user.id, data.ip || '');

  return requireUser(repo.findUserById(db, user.id));
}

export function validateSession(tokenPayload: {
  user_id: number;
  pwd_ver: number;
}): SanitizedUser | null {
  const db = getDb();
  const user = repo.findUserById(db, tokenPayload.user_id);
  if (!user) return null;

  if (tokenPayload.pwd_ver !== user.password_version) return null;

  return sanitizeUser(user);
}

export function changePassword(
  userId: number,
  data: ChangePasswordInput
): void {
  const db = getDb();
  const user = requireUser(repo.findUserById(db, userId));

  if (!verifyPassword(data.old_password, user.password_hash)) {
    throw new AppError('原密码错误', 400);
  }

  const newHash = hashPassword(data.new_password);
  const newVersion = user.password_version + 1;

  repo.updatePassword(db, userId, newHash, newVersion);
}

export function updateName(userId: number, name: string): void {
  const db = getDb();
  requireUser(repo.findUserById(db, userId));
  repo.updateUser(db, userId, { name });
}

export function getAllUsers(): SanitizedUser[] {
  const db = getDb();
  return repo.getAllUsers(db).map(sanitizeUser);
}

export function searchUsers(keyword: string): SanitizedUser[] {
  const db = getDb();
  return repo.searchUsers(db, keyword).map(sanitizeUser);
}

export function adminCreateUser(data: CreateUserInput): { user_id: number } {
  const db = getDb();

  if (repo.userExists(db, data.username)) {
    throw new AppError('用户名已存在', 409);
  }

  const passwordHash = hashPassword(data.password);
  const userId = repo.createUser(db, {
    username: data.username,
    password_hash: passwordHash,
    name: data.name || '',
    role: data.role || 'user',
  });

  return { user_id: userId };
}

export function getUserById(userId: number): SanitizedUser | null {
  const db = getDb();
  const user = repo.findUserById(db, userId);
  return user ? sanitizeUser(user) : null;
}

const BINDING_CODE_TTL = 5 * 60;

function generateCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function generateBindingCode(userId: number, _playerName: string): { code: string } {
  const db = getDb();
  const user = requireUser(repo.findUserById(db, userId));

  if (user.game_id) {
    throw new AppError('已绑定游戏角色，请先解除绑定', 400);
  }

  const code = generateCode();
  const now = Math.floor(Date.now() / 1000);
  repo.updateUser(db, userId, {
    binding_code: code,
    binding_code_expiry: now + BINDING_CODE_TTL,
  });

  return { code };
}

export function verifyBindingCode(code: string, gameId: string): { success: boolean; message: string } {
  const db = getDb();
  const user = repo.findUserByBindingCode(db, code);
  if (!user) {
    throw new AppError('验证码无效', 400);
  }

  const now = Math.floor(Date.now() / 1000);
  if (user.binding_code_expiry && user.binding_code_expiry < now) {
    repo.updateUser(db, user.id, { binding_code: null, binding_code_expiry: null });
    throw new AppError('验证码已过期，请重新获取', 400);
  }

  repo.updateUser(db, user.id, {
    game_id: gameId,
    binding_code: null,
    binding_code_expiry: null,
  });

  return { success: true, message: '绑定成功' };
}

export function unbindGame(userId: number): { success: boolean } {
  const db = getDb();
  const user = requireUser(repo.findUserById(db, userId));

  if (!user.game_id) {
    throw new AppError('未绑定游戏角色', 400);
  }

  repo.updateUser(db, userId, {
    game_id: null,
    binding_code: null,
    binding_code_expiry: null,
  });

  return { success: true };
}
