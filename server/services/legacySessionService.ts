import { randomBytes } from 'node:crypto';

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
// In-memory only, matching this codebase's established "no
// distributed/external infrastructure for a single-server pilot"
// discipline (same reasoning as the in-memory SimulationEngine sessions
// and GpsSimulationEngine sessions from Phase 2B/4A). A restart clears all
// sessions — acceptable for a pilot; a real multi-instance deployment
// would need shared session storage, documented as a known limitation.

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

const sessions = new Map<string, LegacySession>();

/** `ttlMs` defaults to SESSION_TTL_MS; the override exists so tests can construct a deterministically already-expired session (a negative ttlMs) without waiting on a real clock — the same "no waiting on wall-clock time" discipline this codebase's verification-challenge tests already established. */
export function createSession(user: { id: string; email: string; role: string }, ttlMs: number = SESSION_TTL_MS): LegacySession {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  const session: LegacySession = {
    token,
    userId: user.id,
    email: user.email,
    role: user.role,
    issuedAt: now,
    expiresAt: now + ttlMs,
  };
  sessions.set(token, session);
  return session;
}

/** Returns the session if it exists and has not expired; a lazily-expired session is deleted on lookup rather than left to leak memory. */
export function validateSession(token: unknown): LegacySession | null {
  if (typeof token !== 'string' || !token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

export function invalidateSession(token: unknown): void {
  if (typeof token === 'string') sessions.delete(token);
}

/** Test-only reset — mirrors the pattern already established for in-memory engines (SimulationEngine, GpsSimulationEngine) needing a clean slate between test files. */
export function clearAllSessions(): void {
  sessions.clear();
}
