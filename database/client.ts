import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const dbPath = process.env.DATABASE_URL || './database/masara.db';

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
/** The transaction-scoped handle `db.transaction(tx => ...)` passes in — same query-builder surface as `db` itself. */
type Tx = Parameters<DB['transaction']>[0] extends (tx: infer U) => unknown ? U : never;
/** Repository `create` methods accept either this or plain `db`, so a caller can compose several creates into one real atomic transaction. */
export type DbOrTx = DB | Tx;
