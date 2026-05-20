import { getDb } from '../lib/database.js';
import type Database from 'better-sqlite3';
import { loadEnv } from '../config/env.js';

function getSyncItemsUrl(): string {
  return loadEnv().SYNC_ITEMS_URL;
}

interface ItemsData {
  [category: string]: {
    [code: string]: string;
  };
}

async function fetchItemsFromGithub(): Promise<ItemsData> {
  const url = getSyncItemsUrl();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch items: ${response.statusText}`);
  }
  return await response.json();
}

function syncItemsToDatabase(db: Database.Database, itemsData: ItemsData): void {
  const now = Math.floor(Date.now() / 1000);

  // Start transaction
  const transaction = db.transaction(() => {
    // Clear existing items
    db.prepare('DELETE FROM shop_items').run();
    
    // Reset auto increment
    db.prepare("DELETE FROM sqlite_sequence WHERE name = 'shop_items'").run();

    const insertStmt = db.prepare(`
      INSERT INTO shop_items (name, name_cn, name_en, code, category, description, price, stock, quality_max, is_active, image_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, -1, 1, 1, ?, ?, ?)
    `);

    let count = 0;
    for (const [category, items] of Object.entries(itemsData)) {
      for (const [code, nameCn] of Object.entries(items)) {
        // Skip entries where nameCn is the same as code (they don't have a proper Chinese translation)
        let displayName = nameCn;
        const nameEn = code;
        let nameCnValue = nameCn;
        
        if (nameCn === code) {
          // If the Chinese name is the same as the code, use a nicer name
          nameCnValue = code.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          displayName = nameCnValue;
        }

        insertStmt.run(
          displayName,        // name (display name, fallback to nameCn or formatted code)
          nameCnValue,        // name_cn
          nameEn,             // name_en
          code,               // code
          category,           // category
          '',                 // description
          '',                 // image_url
          now,                // created_at
          now                 // updated_at
        );
        count++;
      }
    }

    console.log(`✅ Successfully synced ${count} items from GitHub!`);
  });

  transaction();
}

async function main(): Promise<void> {
  const url = getSyncItemsUrl();
  console.log('📦 Starting item sync from GitHub...');
  console.log(`🌐 Fetching from: ${url}`);

  try {
    const itemsData = await fetchItemsFromGithub();
    const db = getDb();
    syncItemsToDatabase(db, itemsData);
    console.log('🎉 Sync complete!');
  } catch (error) {
    console.error('❌ Error syncing items:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
