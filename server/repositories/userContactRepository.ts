import { and, eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { userContacts } from '../../database/schema';
import type { ContactChannel } from '../domain/contactContract';

type NewUserContact = typeof userContacts.$inferInsert;
type UserContactUpdate = Partial<typeof userContacts.$inferInsert>;

/** Same detection pattern already established in TelemetryIngestionService.ts — real DB-level constraint violations, not an app-level check-then-insert race. */
export function isUniqueConstraintError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/.test(e?.message ?? '');
}

export const userContactRepository = {
  /** May throw on a (userId, channel, normalizedValue) collision — the real, database-enforced duplicate-prevention boundary (spec §12). The caller (UserContactService) catches it via isUniqueConstraintError and translates it to a typed DuplicateContactError. */
  create: (contact: NewUserContact) => {
    const row = { id: crypto.randomUUID(), ...contact };
    db.insert(userContacts).values(row).run();
    return row;
  },
  findById: (id: string) => db.select().from(userContacts).where(eq(userContacts.id, id)).get(),
  findByUserId: (userId: string) => db.select().from(userContacts).where(eq(userContacts.userId, userId)).all(),
  findByUserChannelNormalized: (userId: string, channel: ContactChannel, normalizedValue: string) =>
    db
      .select()
      .from(userContacts)
      .where(and(eq(userContacts.userId, userId), eq(userContacts.channel, channel), eq(userContacts.normalizedValue, normalizedValue)))
      .get(),
  update: (id: string, changes: UserContactUpdate) => db.update(userContacts).set({ ...changes, updatedAt: new Date() }).where(eq(userContacts.id, id)).run(),
  delete: (id: string) => db.delete(userContacts).where(eq(userContacts.id, id)).run(),
  clear: () => db.delete(userContacts).run(),
};
