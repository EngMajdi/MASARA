import { eq } from 'drizzle-orm';
import { db, type DbOrTx } from '../../database/client';
import { users } from '../../database/schema';

type NewGovernedUser = typeof users.$inferInsert;

export const userRepository = {
  findAll: () => db.select().from(users).all(),
  findById: (id: string) => db.select().from(users).where(eq(users.id, id)).get(),
  findByEmail: (email: string) => db.select().from(users).where(eq(users.email, email.toLowerCase().trim())).get(),
  /**
   * Phase 14 — the governed `users` table had NO live creation path at all
   * before this (every prior row came from database/seed/seed.ts). Email is
   * normalized the same way findByEmail's own query normalizes its lookup
   * (`toLowerCase().trim()`) — that normalization is this table's real,
   * pre-existing invariant (every seeded email is already lowercase); a
   * caller that stored a mixed-case email here would make findByEmail
   * silently fail for it (a real bug hit and fixed during Phase 13.1's own
   * live testing).
   */
  create: (input: Omit<NewGovernedUser, 'id' | 'email'> & { email: string }, executor: DbOrTx = db) => {
    const row: NewGovernedUser = { id: crypto.randomUUID(), ...input, email: input.email.toLowerCase().trim() };
    executor.insert(users).values(row).run();
    return row;
  },
};
