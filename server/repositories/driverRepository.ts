import { eq } from 'drizzle-orm';
import { db, type DbOrTx } from '../../database/client';
import { drivers } from '../../database/schema';

type NewDriver = typeof drivers.$inferInsert;

export const driverRepository = {
  findAll: () => db.select().from(drivers).all(),
  findById: (id: string) => db.select().from(drivers).where(eq(drivers.id, id)).get(),
  findByUserId: (userId: string) => db.select().from(drivers).where(eq(drivers.userId, userId)).get(),
  /** Phase 14 — no live creation path existed before this (seed-only, like userRepository.create's own comment). */
  create: (input: Omit<NewDriver, 'id'>, executor: DbOrTx = db) => {
    const row: NewDriver = { id: crypto.randomUUID(), ...input };
    executor.insert(drivers).values(row).run();
    return row;
  },
};
