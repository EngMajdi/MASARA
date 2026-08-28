import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { validatePasswordPolicy, MIN_PASSWORD_LENGTH } from '../../server/services/passwordPolicy';
import { createSession, validateSession, invalidateAllSessionsForUser, clearAllSessions } from '../../server/services/legacySessionService';
import { legacySessionRepository } from '../../server/repositories/legacySessionRepository';
import { hashPassword, verifyPassword } from '../../server/services/legacyAuthCredentials';
import { legacyUserRepository } from '../../server/repositories/legacyUserRepository';
import { tripRepository } from '../../server/repositories/tripRepository';
import { busRepository } from '../../server/repositories/busRepository';
import { studentRepository } from '../../server/repositories/studentRepository';
import { journeyRepository } from '../../server/repositories/journeyRepository';
import { recommendationRepository } from '../../server/repositories/recommendationRepository';
import { auditRepository } from '../../server/repositories/auditRepository';
import { db } from '../../database/client';
import { notifications, etaAccuracyObservations, currentLocationProjection } from '../../database/schema';

beforeEach(() => {
  clearAllSessions();
});

const USER_A = { id: 'u-1', email: 'parent@masara.om', role: 'parent' };
const USER_B = { id: 'u-2', email: 'driver1@masara.om', role: 'driver' };

// ---------------------------------------------------------------------------
// Password policy — deterministic, pure
// ---------------------------------------------------------------------------

describe('validatePasswordPolicy — conservative, deterministic, minimum length only', () => {
  it('rejects a too-short password', () => {
    const result = validatePasswordPolicy('short1');
    expect(result.valid).toBe(false);
    if (result.valid === false) expect(result.error).toBeTruthy();
  });

  it('accepts a password exactly at the minimum length', () => {
    expect(validatePasswordPolicy('a'.repeat(MIN_PASSWORD_LENGTH)).valid).toBe(true);
  });

  it('rejects a password one character short of the minimum', () => {
    expect(validatePasswordPolicy('a'.repeat(MIN_PASSWORD_LENGTH - 1)).valid).toBe(false);
  });

  it('accepts the real seeded demo password ("password123") — no seed data needed to change for this policy', () => {
    expect(validatePasswordPolicy('password123').valid).toBe(true);
  });

  it('never requires symbols/uppercase/digits — a long lowercase-only password is accepted', () => {
    expect(validatePasswordPolicy('lowercaseonlylong').valid).toBe(true);
  });

  it('rejects missing/empty/non-string input without throwing', () => {
    expect(validatePasswordPolicy('').valid).toBe(false);
    expect(validatePasswordPolicy(undefined).valid).toBe(false);
    expect(validatePasswordPolicy(null).valid).toBe(false);
    expect(() => validatePasswordPolicy(12345)).not.toThrow();
    expect(validatePasswordPolicy(12345).valid).toBe(false);
  });

  it('MIN_PASSWORD_LENGTH is a sane, positive, small constant (no complexity theater)', () => {
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(8);
    expect(MIN_PASSWORD_LENGTH).toBeLessThanOrEqual(12);
  });
});

// ---------------------------------------------------------------------------
// Credential hashing convention — reused, not duplicated
// ---------------------------------------------------------------------------

describe('Password hashing — the existing scrypt+salt convention, reused unchanged', () => {
  it('the same password hashes differently each time (random salt) yet both verify correctly', () => {
    const a = hashPassword('a-real-password');
    const b = hashPassword('a-real-password');
    expect(a).not.toBe(b);
    expect(verifyPassword('a-real-password', a)).toBe(true);
    expect(verifyPassword('a-real-password', b)).toBe(true);
  });

  it('a wrong password never verifies', () => {
    const hash = hashPassword('the-real-one');
    expect(verifyPassword('not-the-real-one', hash)).toBe(false);
  });

  it('the stored hash never equals the plaintext password', () => {
    const hash = hashPassword('anotherpassword1');
    expect(hash).not.toBe('anotherpassword1');
    expect(hash).not.toContain('anotherpassword1');
  });
});

// ---------------------------------------------------------------------------
// legacyUserRepository — the credential store persistence itself
// (discovered necessary via this phase's own multi-instance live test)
// ---------------------------------------------------------------------------

describe('legacyUserRepository — the legacy credential store is now persisted, not process-local', () => {
  it('a password updated via one call is immediately visible to a fresh findById/findByEmail read', () => {
    const created = legacyUserRepository.create({ name: 'Test', email: `repo-test-${crypto.randomUUID()}@masara.om`, passwordHash: hashPassword('firstpassword1'), role: 'parent' });
    expect(verifyPassword('firstpassword1', legacyUserRepository.findById(created.id)!.passwordHash)).toBe(true);

    legacyUserRepository.updatePasswordHash(created.id, hashPassword('secondpassword1'));

    const reread = legacyUserRepository.findById(created.id)!;
    expect(verifyPassword('firstpassword1', reread.passwordHash)).toBe(false);
    expect(verifyPassword('secondpassword1', reread.passwordHash)).toBe(true);
  });

  it('findByEmail is case-insensitive and trims whitespace, matching the exact pre-existing behavior', () => {
    const email = `CaseTest-${crypto.randomUUID()}@Masara.OM`;
    const created = legacyUserRepository.create({ name: 'Case Test', email, passwordHash: hashPassword('somepassword1'), role: 'parent' });
    expect(legacyUserRepository.findByEmail(`  ${email.toLowerCase()}  `)?.id).toBe(created.id);
    expect(legacyUserRepository.findByEmail(email.toUpperCase())?.id).toBe(created.id);
  });

  it('the real fix: a password change is visible across two independent database connections to the same file — the exact scenario that was live-broken before this table existed', () => {
    const dbPath = process.env.DATABASE_URL || './database/masara.db';
    const created = legacyUserRepository.create({ name: 'Multi-Instance Test', email: `multi-instance-${crypto.randomUUID()}@masara.om`, passwordHash: hashPassword('originalpass1'), role: 'parent' });

    legacyUserRepository.updatePasswordHash(created.id, hashPassword('changedpass1'));

    // A second, genuinely independent connection — exactly what a second
    // server process opens.
    const independentConn = new Database(dbPath, { readonly: true });
    const row = independentConn.prepare('SELECT password_hash FROM legacy_users WHERE id = ?').get(created.id) as { password_hash: string } | undefined;
    independentConn.close();

    expect(row).toBeTruthy();
    expect(verifyPassword('originalpass1', row!.password_hash)).toBe(false); // old password no longer valid, seen from the other connection
    expect(verifyPassword('changedpass1', row!.password_hash)).toBe(true); // new password valid, seen from the other connection
  });
});

// ---------------------------------------------------------------------------
// Session invalidation — the documented "revoke all, including current" decision
// ---------------------------------------------------------------------------

describe('invalidateAllSessionsForUser — the Phase 7H session invalidation decision', () => {
  it('revokes every session for the target user, including the one that triggered it', () => {
    const first = createSession(USER_A);
    const second = createSession(USER_A);
    expect(validateSession(first.token)).not.toBeNull();
    expect(validateSession(second.token)).not.toBeNull();

    invalidateAllSessionsForUser(USER_A.id);

    expect(validateSession(first.token)).toBeNull();
    expect(validateSession(second.token)).toBeNull();
  });

  it('does not affect a different user\'s sessions', () => {
    const sessionA = createSession(USER_A);
    const sessionB = createSession(USER_B);

    invalidateAllSessionsForUser(USER_A.id);

    expect(validateSession(sessionA.token)).toBeNull();
    expect(validateSession(sessionB.token)).not.toBeNull();
  });

  it('is idempotent — calling it repeatedly never throws and leaves sessions revoked', () => {
    const session = createSession(USER_A);
    expect(() => {
      for (let i = 0; i < 5; i++) invalidateAllSessionsForUser(USER_A.id);
    }).not.toThrow();
    expect(validateSession(session.token)).toBeNull();
  });

  it('calling it for a user with zero sessions is a safe no-op', () => {
    expect(() => invalidateAllSessionsForUser('user-with-no-sessions')).not.toThrow();
  });

  it('works correctly across two independent database connections to the same file (the real multi-process mechanism Phase 7G established)', () => {
    const dbPath = process.env.DATABASE_URL || './database/masara.db';
    const session = createSession(USER_A);
    invalidateAllSessionsForUser(USER_A.id);

    const independentConn = new Database(dbPath, { readonly: true });
    const rows = independentConn.prepare('SELECT revoked_at FROM legacy_sessions WHERE user_id = ?').all(USER_A.id) as Array<{ revoked_at: number | null }>;
    independentConn.close();

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.revoked_at).not.toBeNull();
    void session;
  });
});

// ---------------------------------------------------------------------------
// Authorization — identity is server-resolved, never trusted from input
// ---------------------------------------------------------------------------

describe('Cross-user spoofing is structurally impossible at the primitive level', () => {
  it('revoking sessions requires a real userId — an attacker cannot revoke sessions for a user they do not know the real id of, and revoking a DIFFERENT (guessed/wrong) id never touches the real target', () => {
    const real = createSession(USER_A);
    invalidateAllSessionsForUser('some-other-guessed-id');
    expect(validateSession(real.token)).not.toBeNull(); // untouched — proves scoping is real, not coincidental
  });
});

// ---------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------

describe('MANDATORY: password/session lifecycle operations never mutate operational domain state', () => {
  it('creating sessions, validating, and a full invalidateAllSessionsForUser cycle leaves every operational table unchanged', () => {
    const trip = tripRepository.findAll()[0];
    const bus = busRepository.findById(trip.busId)!;
    const student = studentRepository.findByBusId(trip.busId)[0];

    const tripsBefore = tripRepository.findAll();
    const studentsBefore = studentRepository.findByBusId(trip.busId);
    const journeysBefore = journeyRepository.findByTripId(trip.id);
    const recCountBefore = recommendationRepository.findAll().length;
    const auditCountBefore = auditRepository.findAll().length;
    const notificationsCountBefore = db.select().from(notifications).all().length;
    const etaAccuracyCountBefore = db.select().from(etaAccuracyObservations).all().length;
    const projectionCountBefore = db.select().from(currentLocationProjection).all().length;

    const s1 = createSession(USER_A);
    const s2 = createSession(USER_A);
    validateSession(s1.token);
    validateSession(s2.token);
    invalidateAllSessionsForUser(USER_A.id);
    hashPassword('some-new-password-1');
    verifyPassword('some-new-password-1', hashPassword('some-new-password-1'));
    validatePasswordPolicy('somevalidpassword');

    expect(tripRepository.findAll()).toEqual(tripsBefore);
    expect(studentRepository.findByBusId(trip.busId)).toEqual(studentsBefore);
    expect(journeyRepository.findByTripId(trip.id)).toEqual(journeysBefore);
    expect(recommendationRepository.findAll().length).toBe(recCountBefore);
    expect(auditRepository.findAll().length).toBe(auditCountBefore); // zero audit rows from credential/session activity
    expect(db.select().from(notifications).all().length).toBe(notificationsCountBefore);
    expect(db.select().from(etaAccuracyObservations).all().length).toBe(etaAccuracyCountBefore);
    expect(db.select().from(currentLocationProjection).all().length).toBe(projectionCountBefore);
    expect(student).toBeTruthy(); // fixture sanity
    expect(bus).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Source-scan governance guards
// ---------------------------------------------------------------------------

describe('Source-scan governance guards', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const passwordPolicySource = fs.readFileSync(path.join(repoRoot, 'server/services/passwordPolicy.ts'), 'utf8');
  const sessionServiceSource = fs.readFileSync(path.join(repoRoot, 'server/services/legacySessionService.ts'), 'utf8');
  const sessionRepoSource = fs.readFileSync(path.join(repoRoot, 'server/repositories/legacySessionRepository.ts'), 'utf8');
  const serverSource = fs.readFileSync(path.join(repoRoot, 'server.ts'), 'utf8');

  const forbidden =
    /from ['"].*\/(JourneyService|JourneyStateMachine|ActionExecutor|PolicyEngine|TelemetryIngestionService|EtaService|NotificationService|NotificationPolicy|MasaraOperationsAgent)['"]/;

  it('none of the new/modified Phase 7H files import forbidden governance/domain modules', () => {
    for (const source of [passwordPolicySource, sessionServiceSource, sessionRepoSource]) {
      expect(source).not.toMatch(forbidden);
    }
  });

  it('passwordPolicy.ts performs no I/O, no logging, no hashing — a pure function module', () => {
    expect(passwordPolicySource).not.toMatch(/console\.|require\(|db\.|scryptSync/);
  });

  it('the change-password route never does a plaintext password comparison (=== on password fields)', () => {
    const start = serverSource.indexOf("app.post('/api/auth/change-password'");
    const block = serverSource.slice(start, serverSource.indexOf("\n});", start));
    expect(block).not.toMatch(/currentPassword\s*===\s*user\.password|user\.password\s*===\s*currentPassword|newPassword\s*===\s*user\.password/);
    expect(block).toMatch(/verifyPassword\(/);
  });

  it('the change-password route resolves identity via requireLegacySession, never from req.body.userId/email', () => {
    const start = serverSource.indexOf("app.post('/api/auth/change-password'");
    const block = serverSource.slice(start, serverSource.indexOf("\n});", start));
    expect(block).toMatch(/requireLegacySession\(/);
    expect(block).not.toMatch(/req\.body\.(userId|email|id|role)\b/);
  });

  it('the register route validates the password policy before creating the user (no partial creation on a rejected password)', () => {
    const start = serverSource.indexOf("app.post('/api/auth/register'");
    const block = serverSource.slice(start, serverSource.indexOf("\n});", start));
    const policyCheckIdx = block.indexOf('validatePasswordPolicy(');
    // Phase 14 — persistence moved from a direct legacyUserRepository.create
    // call into ProvisioningService.provisionParentAccount (which creates
    // both the legacy AND governed rows in one real transaction — see that
    // file's own header comment); the ordering guarantee this test protects
    // (policy check strictly before any persistence) now applies to that
    // call instead.
    const provisionIdx = block.indexOf('provisionParentAccount(');
    expect(policyCheckIdx).toBeGreaterThan(-1);
    expect(provisionIdx).toBeGreaterThan(-1);
    expect(policyCheckIdx).toBeLessThan(provisionIdx);
  });

  it('no raw session token, password, or currentPassword/newPassword value is ever passed to console.log/error/warn in these files', () => {
    for (const source of [sessionServiceSource, sessionRepoSource]) {
      expect(source).not.toMatch(/console\.(log|error|warn)\([^)]*\b(token|password)\b(?!Hash)/i);
    }
    // server.ts's change-password/register blocks specifically — the file
    // overall legitimately logs unrelated errors elsewhere (Gemini calls,
    // health checks), so scope this check to the two new/modified blocks.
    for (const routeStart of ["app.post('/api/auth/change-password'", "app.post('/api/auth/register'"]) {
      const start = serverSource.indexOf(routeStart);
      const block = serverSource.slice(start, serverSource.indexOf('\n});', start));
      expect(block).not.toMatch(/console\.(log|error|warn)\(/);
    }
  });

  it('the change-password success response never echoes back currentPassword, newPassword, or the password hash', () => {
    const start = serverSource.indexOf("app.post('/api/auth/change-password'");
    const block = serverSource.slice(start, serverSource.indexOf('\n});', start));
    const successReturn = block.slice(block.lastIndexOf('res.json('));
    expect(successReturn).not.toMatch(/currentPassword|newPassword|passwordHash/);
  });
});
