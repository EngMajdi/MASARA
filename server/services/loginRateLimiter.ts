import { legacyLoginAttemptRepository } from '../repositories/legacyLoginAttemptRepository';

// Phase 7A — minimal login abuse boundary, per-email attempt tracking.
//
// Phase 7G — persisted to the database instead of an in-memory Map, so
// multiple server processes (a real multi-instance deployment) share
// lockout state instead of an attacker resetting their failure count by
// simply hitting a different instance. Every exported function below
// keeps its EXACT prior name/signature/return shape — server.ts needed
// zero changes for this. better-sqlite3 is synchronous, so no async
// ripple was needed either.
//
// Still deliberately NOT written into any domain/audit table: a lockout
// is transient abuse-prevention state, not a fact about a user worth
// auditing, and must never flood audit_logs (spec "no audit-log
// flooding") — this stays its own small, bounded table.

export const MAX_FAILURES = 5;
export const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function keyFor(email: string): string {
  return email.trim().toLowerCase();
}

export type LoginAllowedResult = { allowed: true } | { allowed: false; retryAfterMs: number };

/** Checked BEFORE verifying a password — a locked-out email is rejected without ever touching the password comparison, so a lockout can never be used to distinguish "wrong password" from "unknown email" either. */
export function checkLoginAllowed(email: string): LoginAllowedResult {
  const row = legacyLoginAttemptRepository.findByEmail(keyFor(email));
  if (!row || !row.lockedUntil) return { allowed: true };
  const remaining = row.lockedUntil.getTime() - Date.now();
  if (remaining <= 0) {
    legacyLoginAttemptRepository.deleteByEmail(keyFor(email));
    return { allowed: true };
  }
  return { allowed: false, retryAfterMs: remaining };
}

export function recordLoginFailure(email: string): void {
  const key = keyFor(email);
  const existing = legacyLoginAttemptRepository.findByEmail(key);
  const failures = (existing?.failures ?? 0) + 1;
  const lockedUntil = failures >= MAX_FAILURES ? new Date(Date.now() + LOCKOUT_MS) : (existing?.lockedUntil ?? null);
  legacyLoginAttemptRepository.upsert(key, failures, lockedUntil);
}

/** A successful login resets the relevant failure state (spec mandatory) — a legitimate login is never penalized by past failed attempts once it succeeds. */
export function recordLoginSuccess(email: string): void {
  legacyLoginAttemptRepository.deleteByEmail(keyFor(email));
}

/** Test-only reset. */
export function clearAllLoginAttempts(): void {
  legacyLoginAttemptRepository.clear();
}
