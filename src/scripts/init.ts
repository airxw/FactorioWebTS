import * as readline from 'node:readline';
import { stdin, stdout } from 'node:process';
import { getDb } from '../lib/database.js';
import { register } from '../modules/auth/auth.service.js';
import type { RegisterInput } from '../modules/auth/auth.schema.js';

interface InitOptions {
  checkOnly?: boolean;
  adminUsername?: string;
  adminPassword?: string;
  adminName?: string;
}

function parseArgs(): InitOptions {
  const args = process.argv.slice(2);
  const options: InitOptions = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--check':
        options.checkOnly = true;
        break;
      case '--admin-username':
        options.adminUsername = args[++i];
        break;
      case '--admin-password':
        options.adminPassword = args[++i];
        break;
      case '--admin-name':
        options.adminName = args[++i];
        break;
    }
  }

  return options;
}

export function isInitialized(): boolean {
  const db = getDb();
  const result = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  return result.count > 0;
}

async function prompt(question: string, options?: { hidden?: boolean }): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: stdin,
      output: options?.hidden ? undefined : stdout,
      terminal: true,
    });

    if (options?.hidden) {
      stdout.write(question);
    }

    rl.question(options?.hidden ? '' : question, (answer) => {
      if (options?.hidden) {
        stdout.write('\n');
      }
      rl.close();
      resolve(answer.trim());
    });
  });
}

function printBanner(): void {
  console.log('\n' + '='.repeat(60));
  console.log('  FactorioWeb 初始化部署脚本');
  console.log('='.repeat(60));
  console.log();
}

async function createAdminUser(username: string, password: string, name: string): Promise<void> {
  console.log(`\n正在创建管理员账户: ${username}...`);
  
  try {
    const input: RegisterInput = {
      username,
      password,
      name,
      role: 'admin',
    };
    
    register(input);
    console.log('✓ 管理员账户创建成功');
  } catch (error) {
    console.error('✗ 创建管理员账户失败:', (error as Error).message);
    process.exit(1);
  }
}

function initVipLevels(): void {
  console.log('\n正在初始化VIP等级数据...');
  const db = getDb();

  const vipLevels = [
    { level: 1, name: 'VIP 1', price: 10, duration_days: 30, daily_purchase_limit: 5, single_purchase_limit: 10, max_quality_level: 1 },
    { level: 2, name: 'VIP 2', price: 25, duration_days: 30, daily_purchase_limit: 10, single_purchase_limit: 20, max_quality_level: 2 },
    { level: 3, name: 'VIP 3', price: 50, duration_days: 30, daily_purchase_limit: 20, single_purchase_limit: 50, max_quality_level: 3 },
    { level: 4, name: 'VIP 4', price: 100, duration_days: 30, daily_purchase_limit: 50, single_purchase_limit: 100, max_quality_level: 4 },
    { level: 5, name: 'VIP 5', price: 200, duration_days: 30, daily_purchase_limit: 100, single_purchase_limit: 200, max_quality_level: 5 },
  ];

  try {
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO vip_levels (
        name, level, price, duration_days, daily_purchase_limit, 
        single_purchase_limit, max_quality_level, features_json, 
        is_active, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 1, ?, ?, ?)
    `);

    const now = Math.floor(Date.now() / 1000);
    
    for (const vip of vipLevels) {
      insertStmt.run(
        vip.name,
        vip.level,
        vip.price,
        vip.duration_days,
        vip.daily_purchase_limit,
        vip.single_purchase_limit,
        vip.max_quality_level,
        vip.level,
        now,
        now
      );
    }

    console.log('✓ VIP等级数据初始化成功');
  } catch (error) {
    console.error('✗ VIP等级数据初始化失败:', (error as Error).message);
    process.exit(1);
  }
}

function initShopItems(): void {
  console.log('正在初始化商店物品数据...');
  const db = getDb();

  const shopItems = [
    { name: '铁质护甲', code: 'iron-armor', category: '装备', description: '基础铁质护甲', price: 5, stock: -1, quality_max: 3 },
    { name: '钢质护甲', code: 'steel-armor', category: '装备', description: '高级钢质护甲', price: 15, stock: -1, quality_max: 5 },
    { name: '修理包', code: 'repair-pack', category: '消耗品', description: '用于修复装备', price: 2, stock: 100, quality_max: 1 },
    { name: '子弹', code: 'bullets', category: '弹药', description: '步枪子弹', price: 0.5, stock: 500, quality_max: 1 },
    { name: '医疗包', code: 'medical-pack', category: '消耗品', description: '恢复生命值', price: 8, stock: 50, quality_max: 2 },
  ];

  try {
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO shop_items (
        name, code, category, description, price, 
        stock, quality_max, is_active, image_url, 
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, '', ?, ?)
    `);

    const now = Math.floor(Date.now() / 1000);
    
    for (const item of shopItems) {
      insertStmt.run(
        item.name,
        item.code,
        item.category,
        item.description,
        item.price,
        item.stock,
        item.quality_max,
        now,
        now
      );
    }

    console.log('✓ 商店物品数据初始化成功');
  } catch (error) {
    console.error('✗ 商店物品数据初始化失败:', (error as Error).message);
    process.exit(1);
  }
}

async function interactiveInit(): Promise<void> {
  console.log('请设置管理员账户信息：\n');

  let username = await prompt('管理员用户名: ');
  while (!username || username.length < 3) {
    console.log('用户名至少需要3个字符');
    username = await prompt('管理员用户名: ');
  }

  let password = await prompt('管理员密码: ', { hidden: true });
  while (!password || password.length < 6) {
    console.log('密码至少需要6个字符');
    password = await prompt('管理员密码: ', { hidden: true });
  }

  let confirmPassword = await prompt('确认密码: ', { hidden: true });
  while (password !== confirmPassword) {
    console.log('两次输入的密码不一致');
    password = await prompt('管理员密码: ', { hidden: true });
    confirmPassword = await prompt('确认密码: ', { hidden: true });
  }

  const name = await prompt('管理员昵称 (可选): ');

  await createAdminUser(username, password, name || username);
  initVipLevels();
  initShopItems();

  console.log('\n' + '='.repeat(60));
  console.log('  初始化完成！');
  console.log('='.repeat(60));
  console.log('\n您现在可以使用以下账户登录：');
  console.log(`  用户名: ${username}`);
  console.log(`  密码: ******`);
  console.log('\n启动服务器: npm start');
  console.log();
}

async function nonInteractiveInit(options: InitOptions): Promise<void> {
  const username = options.adminUsername || process.env.ADMIN_USERNAME;
  const password = options.adminPassword || process.env.ADMIN_PASSWORD;
  const name = options.adminName || process.env.ADMIN_NAME;

  if (!username) {
    console.error('错误: 管理员用户名未设置');
    console.error('请设置环境变量 ADMIN_USERNAME 或使用 --admin-username 参数');
    process.exit(1);
  }

  if (!password) {
    console.error('错误: 管理员密码未设置');
    console.error('请设置环境变量 ADMIN_PASSWORD 或使用 --admin-password 参数');
    process.exit(1);
  }

  await createAdminUser(username, password, name || username);
  initVipLevels();
  initShopItems();

  console.log('\n初始化完成！');
}

async function main(): Promise<void> {
  const options = parseArgs();

  if (options.checkOnly) {
    const initialized = isInitialized();
    console.log(initialized ? '已初始化' : '未初始化');
    process.exit(initialized ? 0 : 1);
  }

  printBanner();

  if (isInitialized()) {
    console.log('✓ 系统已完成初始化');
    console.log('提示: 如果需要重新初始化，请先清空数据库');
    process.exit(0);
  }

  console.log('检测到数据库为空，需要进行初始化\n');

  const hasEnvVars = process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD;
  const hasArgs = options.adminUsername && options.adminPassword;

  if (hasEnvVars || hasArgs) {
    await nonInteractiveInit(options);
  } else {
    await interactiveInit();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('初始化脚本执行失败:', error);
    process.exit(1);
  });
}