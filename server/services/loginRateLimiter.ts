// Phase 7A — minimal login abuse boundary. In-memory, per-email attempt
// tracking — appropriate for this single-server pilot (spec: "if a
// dependency is unnecessary, use a small in-memory mechanism"). A real
// distributed deployment (multiple server instances behind a load
// balancer) would need shared rate-limit state (e.g. Redis) — documented
// known limitation, not built here since no such deployment exists yet.
//
// Deliberately NOT persisted into any domain table: a lockout is
// transient abuse-prevention state, not a fact about a user worth
// auditing, and must never flood audit_logs (spec "no audit-log
// flooding").

export const MAX_FAILURES = 5;
export const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

interface AttemptState {
  failures: number;
  lockedUntil: number | null;
}

const attempts = new Map<string, AttemptState>();

function keyFor(email: string): string {
  return email.trim().toLowerCase();
}

export type LoginAllowedResult = { allowed: true } | { allowed: false; retryAfterMs: number };

/** Checked BEFORE verifying a password — a locked-out email is rejected without ever touching the password comparison, so a lockout can never be used to distinguish "wrong password" from "unknown email" either. */
export function checkLoginAllowed(email: string): LoginAllowedResult {
  const state = attempts.get(keyFor(email));
  if (!state || !state.lockedUntil) return { allowed: true };
  const remaining = state.lockedUntil - Date.now();
  if (remaining <= 0) {
    attempts.delete(keyFor(email));
    return { allowed: true };
  }
  return { allowed: false, retryAfterMs: remaining };
}

export function recordLoginFailure(email: string): void {
  const key = keyFor(email);
  const state = attempts.get(key) ?? { failures: 0, lockedUntil: null };
  state.failures += 1;
  if (state.failures >= MAX_FAILURES) {
    state.lockedUntil = Date.now() + LOCKOUT_MS;
  }
  attempts.set(key, state);
}

/** A successful login resets the relevant failure state (spec mandatory) — a legitimate login is never penalized by past failed attempts once it succeeds. */
export function recordLoginSuccess(email: string): void {
  attempts.delete(keyFor(email));
}

/** Test-only reset. */
export function clearAllLoginAttempts(): void {
  attempts.clear();
}
