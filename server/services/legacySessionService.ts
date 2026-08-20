import { randomBytes, createHash } from 'node:crypto';
import { legacySessionRepository } from '../repositories/legacySessionRepository';

// Phase 7A — the ONE authenticated session boundary this application has.
// Scoped additively (spec's own "additive only" resolution): every
// already-governed route (Journey/Telemetry/ETA/Parent/Notification/
// Contact) keeps its existing, already-tested userEmail-claim convention
// completely untouched. This session store is the new thing — issued at
// the legacy login boundary (server.ts), and required by the legacy
// mutation/read surface this phase newly protects
// (server/services/legacyAuthz.ts). It does not replace or wrap the
// governed guards in server/services/authz.ts.
//
// Phase 7G — persisted to the database instead of an in-memory Map, so
// multiple server processes (a real multi-instance deployment) share
// session state instead of each rejecting the other's tokens. Every
// exported function below keeps its EXACT prior name/signature/return
// shape — server.ts and legacyAuthz.ts needed zero changes for this.
// better-sqlite3 is synchronous, so no async ripple was needed either.
//
// The raw token is never persisted — only sha256(token) (see
// database/schema.ts's legacySessions table comment for why sha256, not
// the scrypt+salt convention used for passwords/device secrets). A
// database read (backup, replica, breach) can therefore never recover a
// usable session token.

export interface LegacySession {
  token: string;
  userId: string;
  email: string;
  role: string;
  issuedAt: number;
  expiresAt: number;
}

/** 4 hours — long enough for a school-day shift, short enough that a leaked/forgotten token doesn't stay valid indefinitely. */
export const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

/** How long past expiry/revocation a session row is kept before cleanup may delete it — purely for a brief post-mortem audit trail, not a security boundary (a session past expiresAt/revokedAt is already rejected by validateSession regardless of whether the row still physically exists). */
const CLEANUP_GRACE_MS = 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * `ttlMs` defaults to SESSION_TTL_MS; the override exists so tests can
 * construct a deterministically already-expired session (a negative
 * ttlMs) without waiting on a real clock — the same "no waiting on
 * wall-clock time" discipline this codebase's verification-challenge
 * tests already established.
 *
 * SESSION ROTATION DECISION (Phase 7G, deliberate, not an oversight): a
 * new login always issues a genuinely fresh, cryptographically random
 * token (real rotation of the credential — you can never be handed back
 * an old token, and a full password re-verification gates every issuance)
 * but does NOT revoke the caller's other still-valid sessions. This is a
 * multi-session model, chosen because: (1) it is the exact behavior this
 * codebase has had since Phase 7A — changing it now would silently log a
 * user out of an unrelated tab/device with no UI explanation why; (2) the
 * frontend has no "active sessions" list or "log out other devices"
 * concept anywhere to make an invalidation visible/expected; (3) this is
 * a school-operations tool where an admin/dispatcher legitimately keeping
 * multiple tabs or devices open is normal, not suspicious. If a future
 * phase wants single-session-per-user, it needs a corresponding UI
 * affordance first — this is a product decision, not a security gap
 * (every session still independently expires and can be individually
 * revoked via logout).
 */
export function createSession(user: { id: string; email: string; role: string }, ttlMs: number = SESSION_TTL_MS): LegacySession {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + ttlMs;

  legacySessionRepository.create({
    userId: user.id,
    email: user.email,
    role: user.role,
    tokenHash: hashToken(token),
    expiresAt: new Date(expiresAt),
  });

  // Bounded, opportunistic cleanup of long-stale rows — runs on the
  // highest-frequency auth entrypoint (every login/register), never a
  // background loop or cron dependency (spec Phase 7G "Session Cleanup").
  legacySessionRepository.cleanupStale(new Date(now), CLEANUP_GRACE_MS);

  return { token, userId: user.id, email: user.email, role: user.role, issuedAt: now, expiresAt };
}

/** Returns the session if it exists and has not expired/been revoked; a lazily-expired session is left for the next cleanup sweep rather than deleted synchronously on every read (the row itself carries no secret — only its hash — so leaving it briefly costs nothing security-relevant). */
export function validateSession(token: unknown): LegacySession | null {
  if (typeof token !== 'string' || !token) return null;
  const row = legacySessionRepository.findByTokenHash(hashToken(token));
  if (!row) return null;
  if (row.revokedAt) return null;
  const now = Date.now();
  if (row.expiresAt.getTime() < now) return null;

  legacySessionRepository.touchLastSeen(row.id, new Date(now));
  return { token, userId: row.userId, email: row.email, role: row.role, issuedAt: row.createdAt.getTime(), expiresAt: row.expiresAt.getTime() };
}

/** Idempotent revocation — an unknown/already-revoked token is a silent no-op (logout never leaks whether a token was ever real). */
export function invalidateSession(token: unknown): void {
  if (typeof token !== 'string' || !token) return;
  legacySessionRepository.revokeByTokenHash(hashToken(token), new Date());
}

/** Test-only reset — mirrors the pattern already established for in-memory engines (SimulationEngine, GpsSimulationEngine) needing a clean slate between test files; now clears the persisted table instead of a Map. */
export function clearAllSessions(): void {
  legacySessionRepository.clear();
}

/**
 * Phase 7H — SESSION INVALIDATION DECISION (explicit, per spec, not left
 * ambiguous): a successful password change revokes ALL of the user's
 * sessions, INCLUDING the one that performed the change — not "all other
 * sessions plus a replacement token for the current request." Chosen as
 * the simplest secure option: it requires no "issue a replacement token
 * mid-request" plumbing, and forcing a fresh login after a password
 * change is itself a genuine end-to-end proof that the new password
 * actually works, rather than trusting the client's own claim that it
 * does. The caller (the change-password route) is expected to respond
 * with success and let the client's own next authenticated call fail and
 * prompt a re-login — exactly how an expired/revoked session already
 * behaves today, no new client-facing state to introduce.
 *
 * Reuses the exact same persisted revocation Phase 7G already built
 * (revokedAt on the existing legacy_sessions table) — no tokenVersion
 * column, no second invalidation mechanism.
 */
export function invalidateAllSessionsForUser(userId: string): void {
  legacySessionRepository.revokeAllByUserId(userId, new Date());
}
