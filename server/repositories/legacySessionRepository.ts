import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../database/client';
import { legacySessions } from '../../database/schema';

type NewLegacySession = typeof legacySessions.$inferInsert;

// Phase 7G — persistence for server/services/legacySessionService.ts. Pure
// data access only: no expiry/hashing/token logic lives here, exactly
// mirroring every other repository in this codebase (business rules stay
// in the service layer, repositories stay dumb).

// Bounds how much cleanup work one login-time sweep does — a large
// backlog of stale rows is trimmed gradually across many logins rather
// than in one big blocking DELETE (spec Phase 7G "Session Cleanup":
// bounded cleanup during authentication operations, no background loop).
const CLEANUP_BATCH_LIMIT = 500;

export const legacySessionRepository = {
  create: (session: NewLegacySession) => {
    const row = { id: crypto.randomUUID(), ...session };
    db.insert(legacySessions).values(row).run();
    return row;
  },

  findByTokenHash: (tokenHash: string) => db.select().from(legacySessions).where(eq(legacySessions.tokenHash, tokenHash)).get(),

  touchLastSeen: (id: string, now: Date) => db.update(legacySessions).set({ lastSeenAt: now }).where(eq(legacySessions.id, id)).run(),

  /** Idempotent — revoking an already-revoked or nonexistent session is a silent no-op, matching the prior Map.delete() behavior exactly. */
  revokeByTokenHash: (tokenHash: string, now: Date) =>
    db
      .update(legacySessions)
      .set({ revokedAt: now })
      .where(and(eq(legacySessions.tokenHash, tokenHash), isNull(legacySessions.revokedAt)))
      .run(),

  /** Phase 7H — revokes every currently-valid session for one user (used by password change: "revoke all sessions including current" — see legacySessionService.ts's SESSION INVALIDATION DECISION). Idempotent by construction — only touches rows still `revokedAt IS NULL`. */
  revokeAllByUserId: (userId: string, now: Date) =>
    db
      .update(legacySessions)
      .set({ revokedAt: now })
      .where(and(eq(legacySessions.userId, userId), isNull(legacySessions.revokedAt)))
      .run(),

  /**
   * Bounded batch delete of rows that are long expired or long revoked —
   * never touches a currently-valid session. Raw SQL for the LIMIT-via-
   * subquery trick only (better-sqlite3's SQLite build does not support
   * `DELETE ... LIMIT` directly); the epoch-seconds conversion matches the
   * same convention etaAccuracyRepository.ts already uses for this
   * driver's integer timestamp-mode columns.
   */
  cleanupStale: (now: Date, graceMs: number) => {
    const cutoffSec = Math.floor((now.getTime() - graceMs) / 1000);
    return db.run(sql`
      DELETE FROM legacy_sessions
      WHERE id IN (
        SELECT id FROM legacy_sessions
        WHERE (expires_at < ${cutoffSec}) OR (revoked_at IS NOT NULL AND revoked_at < ${cutoffSec})
        LIMIT ${CLEANUP_BATCH_LIMIT}
      )
    `);
  },

  /** Test-only — full reset between test files, mirroring clearAllSessions()'s prior in-memory-Map semantics. */
  clear: () => db.delete(legacySessions).run(),

  findAll: () => db.select().from(legacySessions).all(),
};
