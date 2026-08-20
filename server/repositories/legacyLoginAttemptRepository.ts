import { eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { legacyLoginAttempts } from '../../database/schema';

// Phase 7G — persistence for server/services/loginRateLimiter.ts. Pure
// data access; all lockout policy (MAX_FAILURES/LOCKOUT_MS/reset-on-success)
// stays in the service layer.

export const legacyLoginAttemptRepository = {
  findByEmail: (email: string) => db.select().from(legacyLoginAttempts).where(eq(legacyLoginAttempts.email, email)).get(),

  /** Upsert-by-hand (find-then-create/update) — this table's row volume is bounded to "currently-locked-out or recently-failing emails", never worth a real UPSERT statement for. */
  upsert: (email: string, failures: number, lockedUntil: Date | null) => {
    const existing = legacyLoginAttemptRepository.findByEmail(email);
    if (existing) {
      db.update(legacyLoginAttempts).set({ failures, lockedUntil, updatedAt: new Date() }).where(eq(legacyLoginAttempts.id, existing.id)).run();
    } else {
      db.insert(legacyLoginAttempts)
        .values({ id: crypto.randomUUID(), email, failures, lockedUntil })
        .run();
    }
  },

  /** A successful login clears tracking entirely — no zeroed row left behind, keeping storage bounded exactly like the prior Map.delete(). */
  deleteByEmail: (email: string) => db.delete(legacyLoginAttempts).where(eq(legacyLoginAttempts.email, email)).run(),

  /** Test-only — full reset between test files. */
  clear: () => db.delete(legacyLoginAttempts).run(),
};
