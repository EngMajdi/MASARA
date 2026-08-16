import path from 'node:path';
import fs from 'node:fs';

// Point every test file at its own throwaway SQLite database, migrated and
// seeded fresh. This must run before anything imports `database/client.ts`,
// so it uses dynamic imports after the env var is set (static imports would
// be hoisted above this assignment).
const testDbPath = path.resolve(__dirname, '../database/masara.test.db');
for (const suffix of ['', '-wal', '-shm']) {
  const p = testDbPath + suffix;
  if (fs.existsSync(p)) fs.rmSync(p);
}

process.env.DATABASE_URL = testDbPath;
process.env.AI_MODE = process.env.AI_MODE || 'mock';

const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
const { db } = await import('../database/client');
migrate(db, { migrationsFolder: './database/migrations' });

const { seed } = await import('../database/seed/seed');
seed();
