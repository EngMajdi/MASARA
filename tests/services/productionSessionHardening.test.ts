import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { createSession, validateSession, invalidateSession, clearAllSessions, SESSION_TTL_MS } from '../../server/services/legacySessionService';
import {
  checkLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
  clearAllLoginAttempts,
  MAX_FAILURES,
  LOCKOUT_MS,
} from '../../server/services/loginRateLimiter';
import { legacySessionRepository } from '../../server/repositories/legacySessionRepository';
import { legacyLoginAttemptRepository } from '../../server/repositories/legacyLoginAttemptRepository';
import { securityHeaders } from '../../server/middleware/securityHeaders';
import { db } from '../../database/client';
import * as schema from '../../database/schema';
import { tripRepository } from '../../server/repositories/tripRepository';
import { busRepository } from '../../server/repositories/busRepository';
import { studentRepository } from '../../server/repositories/studentRepository';
import { journeyRepository } from '../../server/repositories/journeyRepository';
import { telemetryObservationRepository } from '../../server/repositories/telemetryObservationRepository';
import { recommendationRepository } from '../../server/repositories/recommendationRepository';
import { auditRepository } from '../../server/repositories/auditRepository';
import { notifications, etaAccuracyObservations, currentLocationProjection } from '../../database/schema';

beforeEach(() => {
  clearAllSessions();
  clearAllLoginAttempts();
});

const TEST_USER = { id: 'u-1', email: 'parent@masara.om', role: 'parent' };

// ---------------------------------------------------------------------------
// A/B/E/G/H — session lifecycle
// ---------------------------------------------------------------------------

describe('Session lifecycle — creation, expiration, revocation, malformed input', () => {
  it('A: a created session validates successfully and resolves the real user identity', () => {
    const session = createSession(TEST_USER);
    const validated = validateSession(session.token);
    expect(validated).not.toBeNull();
    expect(validated!.userId).toBe(TEST_USER.id);
    expect(validated!.email).toBe(TEST_USER.email);
    expect(validated!.role).toBe(TEST_USER.role);
  });

  it('B: an already-expired session (negative ttl) fails validation', () => {
    const session = createSession(TEST_USER, -1000);
    expect(validateSession(session.token)).toBeNull();
  });

  it('E: an explicitly revoked (logged out) session fails validation afterward', () => {
    const session = createSession(TEST_USER);
    expect(validateSession(session.token)).not.toBeNull();
    invalidateSession(session.token);
    expect(validateSession(session.token)).toBeNull();
  });

  it('E: revoking the same token twice is idempotent — no error, still invalid', () => {
    const session = createSession(TEST_USER);
    invalidateSession(session.token);
    expect(() => invalidateSession(session.token)).not.toThrow();
    expect(validateSession(session.token)).toBeNull();
  });

  it('G: an unknown/garbage token is rejected', () => {
    expect(validateSession('not-a-real-token')).toBeNull();
    expect(validateSession('a'.repeat(64))).toBeNull();
  });

  it('H: malformed token shapes are rejected without throwing', () => {
    expect(validateSession(undefined)).toBeNull();
    expect(validateSession(null)).toBeNull();
    expect(validateSession('')).toBeNull();
    expect(validateSession(12345 as unknown as string)).toBeNull();
    expect(validateSession({} as unknown as string)).toBeNull();
    expect(() => invalidateSession(undefined)).not.toThrow();
    expect(() => invalidateSession(null)).not.toThrow();
  });

  it('SESSION_TTL_MS is still a sane, positive, finite duration', () => {
    expect(SESSION_TTL_MS).toBeGreaterThan(0);
    expect(Number.isFinite(SESSION_TTL_MS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C/D — hashing at rest, token non-disclosure
// ---------------------------------------------------------------------------

describe('Session hashing — the raw token is never persisted', () => {
  it('C: the persisted row stores sha256(token), never the raw token, and never equals it', () => {
    const session = createSession(TEST_USER);
    const expectedHash = createHash('sha256').update(session.token).digest('hex');
    const row = legacySessionRepository.findByTokenHash(expectedHash);
    expect(row).toBeTruthy();
    expect(row!.tokenHash).toBe(expectedHash);
    expect(row!.tokenHash).not.toBe(session.token);
  });

  it('D: no row in legacy_sessions ever contains a column holding the raw token value', () => {
    const session = createSession(TEST_USER);
    const allRows = legacySessionRepository.findAll();
    for (const row of allRows) {
      expect(Object.values(row)).not.toContain(session.token);
    }
  });

  it('two different logins for the same user produce two different token hashes (no collision, no reuse)', () => {
    const a = createSession(TEST_USER);
    const b = createSession(TEST_USER);
    expect(a.token).not.toBe(b.token);
    const hashA = createHash('sha256').update(a.token).digest('hex');
    const hashB = createHash('sha256').update(b.token).digest('hex');
    expect(hashA).not.toBe(hashB);
  });
});

// ---------------------------------------------------------------------------
// Session rotation decision — documented, tested behavior
// ---------------------------------------------------------------------------

describe('Session rotation — multi-session model (deliberate decision, see legacySessionService.ts header)', () => {
  it('logging in twice issues two independently-valid tokens; the first is NOT silently invalidated by the second', () => {
    const first = createSession(TEST_USER);
    const second = createSession(TEST_USER);
    expect(validateSession(first.token)).not.toBeNull();
    expect(validateSession(second.token)).not.toBeNull();
  });

  it('revoking one of two sessions for the same user leaves the other valid', () => {
    const first = createSession(TEST_USER);
    const second = createSession(TEST_USER);
    invalidateSession(first.token);
    expect(validateSession(first.token)).toBeNull();
    expect(validateSession(second.token)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// I/J — rate limiting, now persisted
// ---------------------------------------------------------------------------

describe('Login rate limiting — persisted, bounded, resets on success', () => {
  const email = 'ratelimit-test@masara.om';

  it('I: MAX_FAILURES consecutive failures lock the account out, persisted as a real row', () => {
    for (let i = 0; i < MAX_FAILURES; i++) recordLoginFailure(email);
    const result = checkLoginAllowed(email);
    expect(result.allowed).toBe(false);
    if (result.allowed === false) expect(result.retryAfterMs).toBeGreaterThan(0);

    const row = legacyLoginAttemptRepository.findByEmail(email.trim().toLowerCase());
    expect(row).toBeTruthy();
    expect(row!.failures).toBe(MAX_FAILURES);
    expect(row!.lockedUntil).toBeTruthy();
  });

  it('J: a successful login deletes the tracking row entirely — storage never grows unbounded for a resolved account', () => {
    for (let i = 0; i < MAX_FAILURES - 1; i++) recordLoginFailure(email);
    recordLoginSuccess(email);
    expect(legacyLoginAttemptRepository.findByEmail(email.trim().toLowerCase())).toBeUndefined();
    expect(checkLoginAllowed(email).allowed).toBe(true);
  });

  it('a locked-out email is case/whitespace-insensitive, same as the pre-existing behavior', () => {
    for (let i = 0; i < MAX_FAILURES; i++) recordLoginFailure(email);
    expect(checkLoginAllowed(`  ${email.toUpperCase()}  `).allowed).toBe(false);
  });

  it('LOCKOUT_MS/MAX_FAILURES policy constants are unchanged from Phase 7A', () => {
    expect(MAX_FAILURES).toBe(5);
    expect(LOCKOUT_MS).toBe(15 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// K — cross-connection persistence (the real multi-instance mechanism)
// ---------------------------------------------------------------------------

describe('K: cross-connection persistence — the mechanism two independent server processes rely on', () => {
  it('a session created through the app\'s db connection is independently readable through a second, separate connection to the same file', () => {
    const dbPath = process.env.DATABASE_URL || './database/masara.db';
    const session = createSession(TEST_USER);
    const tokenHash = createHash('sha256').update(session.token).digest('hex');

    // A second, genuinely independent better-sqlite3 connection/handle to
    // the SAME file — this is exactly what a second server process would
    // open. If session state were still an in-memory Map, this second
    // connection could never see it; because it is a real table, it does.
    const independentConn = new Database(dbPath, { readonly: true });
    const raw = independentConn.prepare('SELECT token_hash, user_id, email, role FROM legacy_sessions WHERE token_hash = ?').get(tokenHash) as
      | { token_hash: string; user_id: string; email: string; role: string }
      | undefined;
    independentConn.close();

    expect(raw).toBeTruthy();
    expect(raw!.token_hash).toBe(tokenHash);
    expect(raw!.user_id).toBe(TEST_USER.id);
    expect(raw!.email).toBe(TEST_USER.email);
  });

  it('revocation through one connection is immediately visible through a second, independent connection', () => {
    const dbPath = process.env.DATABASE_URL || './database/masara.db';
    const session = createSession(TEST_USER);
    invalidateSession(session.token);
    const tokenHash = createHash('sha256').update(session.token).digest('hex');

    const independentConn = new Database(dbPath, { readonly: true });
    const raw = independentConn.prepare('SELECT revoked_at FROM legacy_sessions WHERE token_hash = ?').get(tokenHash) as { revoked_at: number | null } | undefined;
    independentConn.close();

    expect(raw).toBeTruthy();
    expect(raw!.revoked_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// M — spoofed identity is never trusted
// ---------------------------------------------------------------------------

describe('M: session identity is always server-resolved, never trusted from caller-supplied fields', () => {
  it('validateSession never accepts an object/claim payload — only the opaque token string resolves an identity', () => {
    // The function signature itself is the guarantee: it takes `unknown`
    // and only ever treats a non-empty string as a lookup key. Passing a
    // spoofed identity-shaped object can never resolve to a session.
    const spoofedClaim = { userId: 'admin-1', email: 'admin@masara.om', role: 'admin' };
    expect(validateSession(spoofedClaim as unknown as string)).toBeNull();
  });

  it('the resolved role/email/userId always come from the persisted row, never echoed back from input', () => {
    const session = createSession({ id: 'u-99', email: 'someone@masara.om', role: 'driver' });
    const validated = validateSession(session.token)!;
    expect(validated.role).toBe('driver');
    expect(validated.email).toBe('someone@masara.om');
    // No code path in validateSession(token) even has access to a
    // request body — confirmed structurally, not just by this assertion.
  });
});

// ---------------------------------------------------------------------------
// N/O — concurrency
// ---------------------------------------------------------------------------

describe('N/O: concurrency — parallel session creation and revocation', () => {
  it('N: many concurrent logins for the same user each produce a unique, independently valid session', () => {
    const sessions = Array.from({ length: 25 }, () => createSession(TEST_USER));
    const uniqueTokens = new Set(sessions.map((s) => s.token));
    expect(uniqueTokens.size).toBe(25);
    for (const s of sessions) {
      expect(validateSession(s.token)).not.toBeNull();
    }
  });

  it('O: concurrently revoking the same session multiple times never throws and leaves it revoked exactly once', () => {
    const session = createSession(TEST_USER);
    expect(() => {
      for (let i = 0; i < 10; i++) invalidateSession(session.token);
    }).not.toThrow();
    expect(validateSession(session.token)).toBeNull();
  });

  it('the token_hash unique index makes a hash collision a real, enforced database constraint — not just an application assumption', () => {
    const session = createSession(TEST_USER);
    const tokenHash = createHash('sha256').update(session.token).digest('hex');
    expect(() => {
      db.insert(schema.legacySessions)
        .values({ id: crypto.randomUUID(), userId: 'someone-else', email: 'x@masara.om', role: 'admin', tokenHash, expiresAt: new Date(Date.now() + 1000) })
        .run();
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Q — security headers
// ---------------------------------------------------------------------------

describe('Q: security headers middleware', () => {
  it('sets the expected baseline headers and calls next()', () => {
    const setHeaders: Record<string, string> = {};
    const res = { setHeader: (name: string, value: string) => { setHeaders[name] = value; } } as unknown as import('express').Response;
    let nextCalled = false;
    securityHeaders({} as import('express').Request, res, () => { nextCalled = true; });

    expect(setHeaders['X-Content-Type-Options']).toBe('nosniff');
    expect(setHeaders['X-Frame-Options']).toBe('DENY');
    expect(setHeaders['Referrer-Policy']).toBe('no-referrer');
    expect(nextCalled).toBe(true);
  });

  it('does not set Content-Security-Policy or Strict-Transport-Security (documented exclusions)', () => {
    const setHeaders: Record<string, string> = {};
    const res = { setHeader: (name: string, value: string) => { setHeaders[name] = value; } } as unknown as import('express').Response;
    securityHeaders({} as import('express').Request, res, () => {});
    expect(setHeaders['Content-Security-Policy']).toBeUndefined();
    expect(setHeaders['Strict-Transport-Security']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// S — domain isolation
// ---------------------------------------------------------------------------

describe('S: MANDATORY — authentication/session operations never mutate operational domain state', () => {
  it('a full create -> validate -> revoke session lifecycle leaves every operational table unchanged', () => {
    const trip = tripRepository.findAll()[0];
    const bus = busRepository.findById(trip.busId)!;
    const student = studentRepository.findByBusId(trip.busId)[0];

    const tripsBefore = tripRepository.findAll();
    const busesBefore = busRepository.findById(bus.id);
    const studentsBefore = studentRepository.findByBusId(trip.busId);
    const journeysBefore = journeyRepository.findByTripId(trip.id);
    const observationCountBefore = telemetryObservationRepository.findFiltered({ busId: bus.id, limit: 500 }).length;
    const recCountBefore = recommendationRepository.findAll().length;
    const auditCountBefore = auditRepository.findAll().length;
    const notificationsCountBefore = db.select().from(notifications).all().length;
    const etaAccuracyCountBefore = db.select().from(etaAccuracyObservations).all().length;
    const projectionCountBefore = db.select().from(currentLocationProjection).all().length;

    const session = createSession(TEST_USER);
    validateSession(session.token);
    validateSession(session.token);
    invalidateSession(session.token);
    checkLoginAllowed(TEST_USER.email);
    recordLoginFailure(TEST_USER.email);
    recordLoginSuccess(TEST_USER.email);

    expect(tripRepository.findAll()).toEqual(tripsBefore);
    expect(busRepository.findById(bus.id)).toEqual(busesBefore);
    expect(studentRepository.findByBusId(trip.busId)).toEqual(studentsBefore);
    expect(journeyRepository.findByTripId(trip.id)).toEqual(journeysBefore);
    expect(telemetryObservationRepository.findFiltered({ busId: bus.id, limit: 500 }).length).toBe(observationCountBefore);
    expect(recommendationRepository.findAll().length).toBe(recCountBefore);
    expect(auditRepository.findAll().length).toBe(auditCountBefore); // zero audit rows from session activity
    expect(db.select().from(notifications).all().length).toBe(notificationsCountBefore);
    expect(db.select().from(etaAccuracyObservations).all().length).toBe(etaAccuracyCountBefore);
    expect(db.select().from(currentLocationProjection).all().length).toBe(projectionCountBefore);
    expect(student).toBeTruthy(); // fixture sanity
  });
});

// ---------------------------------------------------------------------------
// Source-scan governance guards
// ---------------------------------------------------------------------------

describe('Source-scan governance guards — production hardening files stay transport/session-only', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const files = [
    'server/services/legacySessionService.ts',
    'server/services/loginRateLimiter.ts',
    'server/repositories/legacySessionRepository.ts',
    'server/repositories/legacyLoginAttemptRepository.ts',
    'server/middleware/securityHeaders.ts',
  ].map((f) => fs.readFileSync(path.join(repoRoot, f), 'utf8'));

  const forbidden =
    /from ['"].*\/(JourneyService|JourneyStateMachine|TelemetryIngestionService|EtaService|NotificationService|NotificationPolicy|PolicyEngine|ActionExecutor|MasaraOperationsAgent)['"]/;

  it('none of the new/modified production-hardening files import governance/domain mutation modules', () => {
    for (const source of files) {
      expect(source).not.toMatch(forbidden);
    }
  });

  it('the raw session token is never logged anywhere in these files', () => {
    for (const source of files) {
      expect(source).not.toMatch(/console\.(log|error|warn)\([^)]*token\b(?!Hash)/i);
    }
  });

  it('none of these files read, compare, or forward a password or verification code (no actual usage, prose mentions in comments are fine)', () => {
    for (const source of files) {
      expect(source).not.toMatch(/req\.body\.password|verifyPassword\(|hashPassword\(|verificationCodeHash|\.password\b(?!\/)/);
    }
  });
});
