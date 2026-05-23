import Database from 'better-sqlite3';
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { loadEnv } from '../config/env.js';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const env = loadEnv();
    const dbPath = path.resolve(env.DB_PATH);
    const dir = path.dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    ensureSchema(db);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function ensureSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      executed_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = database
    .prepare('SELECT name FROM migrations')
    .all() as { name: string }[];
  const appliedSet = new Set(applied.map((r) => r.name));

  const migrations: Array<{ name: string; sql: string }> = [];

  migrations.push({
    name: '001_create_users',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
        password_version INTEGER NOT NULL DEFAULT 1,
        game_id TEXT,
        binding_code TEXT,
        vip_level INTEGER NOT NULL DEFAULT 0,
        vip_expiry INTEGER,
        last_login_ip TEXT,
        last_login_at INTEGER,
        login_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `,
  });

  migrations.push({
    name: '002_create_shop_items',
    sql: `
      CREATE TABLE IF NOT EXISTS shop_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        price REAL NOT NULL DEFAULT 0,
        stock INTEGER NOT NULL DEFAULT -1,
        quality_max INTEGER NOT NULL DEFAULT 1,
        is_active INTEGER NOT NULL DEFAULT 1,
        image_url TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `,
  });

  migrations.push({
    name: '003_create_orders',
    sql: `
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        player_name TEXT NOT NULL DEFAULT '',
        quantity INTEGER NOT NULL DEFAULT 1,
        total_price REAL NOT NULL DEFAULT 0,
        quality_level INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered','cancelled')),
        delivered_to_player TEXT,
        delivered_at INTEGER,
        rcon_command TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (item_id) REFERENCES shop_items(id)
      )
    `,
  });

  migrations.push({
    name: '004_create_vip_levels',
    sql: `
      CREATE TABLE IF NOT EXISTS vip_levels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        level INTEGER NOT NULL UNIQUE,
        price REAL NOT NULL DEFAULT 0,
        duration_days INTEGER NOT NULL DEFAULT 30,
        daily_purchase_limit INTEGER NOT NULL DEFAULT 5,
        single_purchase_limit INTEGER NOT NULL DEFAULT 10,
        max_quality_level INTEGER NOT NULL DEFAULT 1,
        features_json TEXT NOT NULL DEFAULT '[]',
        is_active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `,
  });

  migrations.push({
    name: '005_create_player_histories',
    sql: `
      CREATE TABLE IF NOT EXISTS player_histories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_name TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_data TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      )
    `,
  });

  migrations.push({
    name: '006_create_votes',
    sql: `
      CREATE TABLE IF NOT EXISTS votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        initiator_id INTEGER NOT NULL,
        target_player TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'kick',
        reason TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','passed','failed','cancelled')),
        yes_votes INTEGER NOT NULL DEFAULT 0,
        no_votes INTEGER NOT NULL DEFAULT 0,
        cooldown_until INTEGER,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (initiator_id) REFERENCES users(id)
      )
    `,
  });

  migrations.push({
    name: '007_create_vote_records',
    sql: `
      CREATE TABLE IF NOT EXISTS vote_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vote_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        vote TEXT NOT NULL CHECK(vote IN ('yes','no')),
        created_at INTEGER NOT NULL,
        UNIQUE(vote_id, user_id),
        FOREIGN KEY (vote_id) REFERENCES votes(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `,
  });

  migrations.push({
    name: '008_create_vote_config',
    sql: `
      CREATE TABLE IF NOT EXISTS vote_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      )
    `,
  });

  migrations.push({
    name: '009_create_chat_settings',
    sql: `
      CREATE TABLE IF NOT EXISTS chat_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      )
    `,
  });

  migrations.push({
    name: '010_create_trigger_responses',
    sql: `
      CREATE TABLE IF NOT EXISTS trigger_responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trigger_text TEXT NOT NULL,
        response_text TEXT NOT NULL DEFAULT '',
        case_sensitive INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `,
  });

  migrations.push({
    name: '011_create_server_responses',
    sql: `
      CREATE TABLE IF NOT EXISTS server_responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        response_key TEXT NOT NULL UNIQUE,
        response_value TEXT NOT NULL DEFAULT '',
        response_type TEXT NOT NULL DEFAULT 'chat',
        cooldown_seconds INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )
    `,
  });

  migrations.push({
    name: '012_create_periodic_messages',
    sql: `
      CREATE TABLE IF NOT EXISTS periodic_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL DEFAULT 'chat',
        content TEXT NOT NULL DEFAULT '',
        item_code TEXT NOT NULL DEFAULT '',
        item_count INTEGER NOT NULL DEFAULT 1,
        interval_type TEXT NOT NULL DEFAULT 'minutes' CHECK(interval_type IN ('seconds','minutes','hours')),
        interval_value INTEGER NOT NULL DEFAULT 30,
        target TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `,
  });

  migrations.push({
    name: '013_create_chat_player_events',
    sql: `
      CREATE TABLE IF NOT EXISTS chat_player_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        message TEXT NOT NULL DEFAULT '',
        target TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      )
    `,
  });

  migrations.push({
    name: '014_create_mods',
    sql: `
      CREATE TABLE IF NOT EXISTS mods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        version TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        is_enabled INTEGER NOT NULL DEFAULT 1,
        is_installed INTEGER NOT NULL DEFAULT 1,
        has_update INTEGER NOT NULL DEFAULT 0,
        game_version TEXT NOT NULL DEFAULT '',
        download_url TEXT NOT NULL DEFAULT '',
        file_path TEXT NOT NULL DEFAULT '',
        dependencies_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(name, version)
      )
    `,
  });

  migrations.push({
    name: '015_create_versions',
    sql: `
      CREATE TABLE IF NOT EXISTS versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT NOT NULL UNIQUE,
        release_type TEXT NOT NULL DEFAULT 'stable',
        is_current INTEGER NOT NULL DEFAULT 0,
        backup_path TEXT NOT NULL DEFAULT '',
        file_size INTEGER NOT NULL DEFAULT 0,
        sha256 TEXT NOT NULL DEFAULT '',
        installed_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `,
  });

  migrations.push({
    name: '016_create_config_templates',
    sql: `
      CREATE TABLE IF NOT EXISTS config_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        config_json TEXT NOT NULL DEFAULT '{}',
        created_by TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `,
  });

  migrations.push({
    name: '017_add_name_cn_name_en_to_shop_items',
    sql: `
      ALTER TABLE shop_items ADD COLUMN name_cn TEXT NOT NULL DEFAULT '';
      ALTER TABLE shop_items ADD COLUMN name_en TEXT NOT NULL DEFAULT '';
    `,
  });

  migrations.push({
    name: '018_create_item_requests',
    sql: `
      CREATE TABLE IF NOT EXISTS item_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        code TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL DEFAULT '',
        name_cn TEXT NOT NULL DEFAULT '',
        requester TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
        quantity INTEGER NOT NULL DEFAULT 1,
        quality_level INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (item_id) REFERENCES shop_items(id)
      )
    `,
  });

  migrations.push({
    name: '019_create_page_permissions',
    sql: `
      CREATE TABLE IF NOT EXISTS page_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        page_id TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL DEFAULT '',
        visible_to_user INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )
    `,
  });

  migrations.push({
    name: '020_create_cart_items',
    sql: `
      CREATE TABLE IF NOT EXISTS cart_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        quality_level INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(user_id, item_id, quality_level),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (item_id) REFERENCES shop_items(id)
      )
    `,
  });

  migrations.push({
    name: '021_add_binding_code_expiry',
    sql: `
      ALTER TABLE users ADD COLUMN binding_code_expiry INTEGER;
    `,
  });

  migrations.push({
    name: '022_add_config_type_to_templates',
    sql: `
      ALTER TABLE config_templates ADD COLUMN config_type TEXT;
    `,
  });

  migrations.push({
    name: '023_create_gift_claims',
    sql: `
      CREATE TABLE IF NOT EXISTS gift_claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_name TEXT NOT NULL,
        gift_type TEXT NOT NULL,
        items_json TEXT NOT NULL DEFAULT '[]',
        claimed_at INTEGER NOT NULL
      )
    `,
  });

  migrations.push({
    name: '024_create_indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_mods_name ON mods(name);
      CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_votes_status ON votes(status);
      CREATE INDEX IF NOT EXISTS idx_player_histories_player ON player_histories(player_name);
      CREATE INDEX IF NOT EXISTS idx_gift_claims_player_type ON gift_claims(player_name, gift_type);
    `,
  });

  migrations.push({
    name: '025_create_pending_commands',
    sql: `
      CREATE TABLE IF NOT EXISTS pending_commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','delivered','failed','discarded')),
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 5,
        retry_after INTEGER,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pending_commands_status ON pending_commands(status);
      CREATE INDEX IF NOT EXISTS idx_pending_commands_retry ON pending_commands(retry_after);
    `,
  });

  migrations.push({
    name: '026_create_cdk_codes',
    sql: `
      CREATE TABLE IF NOT EXISTS cdk_codes (
        code TEXT PRIMARY KEY,
        command TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'UNUSED' CHECK(status IN ('UNUSED','USED')),
        item_id INTEGER,
        player_name TEXT,
        type TEXT NOT NULL DEFAULT 'shop' CHECK(type IN ('shop','vip')),
        user_id INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cdk_codes_status ON cdk_codes(status);
    `,
  });

  migrations.push({
    name: '027_add_delivery_method_to_orders',
    sql: `
      ALTER TABLE orders ADD COLUMN delivery_method TEXT NOT NULL DEFAULT 'cdk' CHECK(delivery_method IN ('cdk','direct'));
    `,
  });

  migrations.push({
    name: '028_add_cdk_code_to_orders',
    sql: `
      ALTER TABLE orders ADD COLUMN cdk_code TEXT;
    `,
  });

  for (const migration of migrations) {
    if (!appliedSet.has(migration.name)) {
      database.exec(migration.sql);
      database
        .prepare('INSERT INTO migrations (name) VALUES (?)')
        .run(migration.name);

      if (migration.name === '019_create_page_permissions') {
        seedDefaultPagePermissions(database);
      }
    }
  }
}

function seedDefaultPagePermissions(database: Database.Database): void {
  const now = Math.floor(Date.now() / 1000);
  const stmt = database.prepare(`
    INSERT OR IGNORE INTO page_permissions (page_id, label, visible_to_user, updated_at)
    VALUES (?, ?, ?, ?)
  `);

  const defaultPages: Array<[string, string, number]> = [
    ['dashboard', '控制台', 0],
    ['server-control', '服务器控制', 0],
    ['players', '玩家管理', 0],
    ['saves', '存档管理', 0],
    ['items', '物品管理', 0],
    ['item-requests', '物品请求审批', 0],
    ['shop', '商店', 1],
    ['vip', 'VIP系统', 0],
    ['vote', '投票管理', 0],
    ['config', '配置管理', 0],
    ['mod', '模组管理', 0],
    ['console', 'RCON控制台', 0],
    ['users', '用户管理', 0],
    ['profile', '个人中心', 1],
    ['periodic-messages', '周期消息', 0],
    ['chat-settings', '聊天设置', 0],
    ['server-responses', '服务器响应', 0],
    ['logs', '日志查看', 0],
  ];

  const insertMany = database.transaction(
    (pages: Array<[string, string, number]>) => {
      for (const [pageId, label, visible] of pages) {
        stmt.run(pageId, label, visible, now);
      }
    }
  );

  insertMany(defaultPages);
}
