import { eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { legacyUsers } from '../../database/schema';

type NewLegacyUser = typeof legacyUsers.$inferInsert;

// Phase 7H — persistence for the legacy identity store server.ts's
// `/api/auth/*` routes operate on. Pure data access only, mirroring every
// other repository in this codebase; the case-insensitive email matching
// convention server.ts already used (`u.email.toLowerCase() === ...`) is
// preserved exactly via a JS filter over findAll() rather than a SQL
// LOWER() comparison — this table holds only a handful of rows (the
// seeded demo accounts plus whatever a pilot's real users register), so
// there is no performance reason to do it differently, and doing it
// identically avoids any subtle case-matching behavior change.

export const legacyUserRepository = {
  findAll: () => db.select().from(legacyUsers).all(),

  findById: (id: string) => db.select().from(legacyUsers).where(eq(legacyUsers.id, id)).get(),

  findByEmail: (email: string) => {
    const needle = email.toLowerCase().trim();
    return legacyUserRepository.findAll().find((u) => u.email.toLowerCase() === needle);
  },

  create: (user: NewLegacyUser) => {
    const row = { id: crypto.randomUUID(), ...user };
    db.insert(legacyUsers).values(row).run();
    return row;
  },

  updatePasswordHash: (id: string, passwordHash: string) =>
    db.update(legacyUsers).set({ passwordHash, updatedAt: new Date() }).where(eq(legacyUsers.id, id)).run(),

  // Phase 8B — employee provisioning primitives.

  updateStatus: (id: string, status: 'active' | 'disabled') =>
    db.update(legacyUsers).set({ status, updatedAt: new Date() }).where(eq(legacyUsers.id, id)).run(),

  setMustChangePassword: (id: string, mustChangePassword: boolean) =>
    db.update(legacyUsers).set({ mustChangePassword, updatedAt: new Date() }).where(eq(legacyUsers.id, id)).run(),

  /** Test-only — full reset between test files. */
  clear: () => db.delete(legacyUsers).run(),
};
