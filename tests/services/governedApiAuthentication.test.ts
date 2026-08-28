import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { requireVerifiedEmail, requireParentUser, requireOperationalUser } from '../../server/services/authz';
import { createSession, invalidateSession, clearAllSessions } from '../../server/services/legacySessionService';
import { userRepository } from '../../server/repositories/userRepository';
import { legacyUserRepository } from '../../server/repositories/legacyUserRepository';

// Phase 11 — regression coverage for the P0 confirmed live in the Phase 10
// UAT: every governed route (Parent Live Journey, GPS Live Radar, ETA,
// Approval Center, AI agent actions, and more) used to authenticate a
// caller SOLELY by trusting a client-supplied `userEmail` query/body field,
// with zero verification the caller actually held a session for that
// email — an unauthenticated `fetch('/api/parent/journeys?userEmail=parent@masara.om')`
// returned that parent's real children's live GPS location. `requireVerifiedEmail`
// (authz.ts) is the fix: it resolves identity exclusively from a real,
// server-issued, revocable session token, never from anything client-claimed.

beforeEach(() => {
  clearAllSessions();
});

function realLegacyUser(role: string) {
  const user = legacyUserRepository.findAll().find((u) => u.role === role);
  if (!user) throw new Error(`no seeded legacy user with role ${role}`);
  return user;
}

describe('requireVerifiedEmail — the single identity boundary every governed route now requires', () => {
  it('rejects a request with no Authorization header at all — the exact exploit shape from the Phase 10 UAT', () => {
    const result = requireVerifiedEmail(undefined);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.status).toBe(401);
  });

  it('rejects a malformed Authorization header (not "Bearer <token>")', () => {
    const result = requireVerifiedEmail('parent@masara.om'); // the old exploit's payload, now offered as a header instead of a query param — still rejected
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.status).toBe(401);
  });

  it('rejects an unknown/garbage bearer token', () => {
    const result = requireVerifiedEmail('Bearer totally-fake-token-that-was-never-issued');
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.status).toBe(401);
  });

  it('rejects a token belonging to a session that has been revoked (logout)', () => {
    const admin = realLegacyUser('admin');
    const session = createSession({ id: admin.id, email: admin.email, role: admin.role });
    expect(requireVerifiedEmail(`Bearer ${session.token}`).ok).toBe(true); // sanity: works before revocation
    invalidateSession(session.token);
    const result = requireVerifiedEmail(`Bearer ${session.token}`);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.status).toBe(401);
  });

  it('rejects an already-expired session token', () => {
    const parent = realLegacyUser('parent');
    const session = createSession({ id: parent.id, email: parent.email, role: parent.role }, -1000); // expired the instant it was created
    const result = requireVerifiedEmail(`Bearer ${session.token}`);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.status).toBe(401);
  });

  it('a genuinely valid session resolves to that session\'s OWN real email — never a caller-supplied one', () => {
    const parent = realLegacyUser('parent');
    const session = createSession({ id: parent.id, email: parent.email, role: parent.role });
    const result = requireVerifiedEmail(`Bearer ${session.token}`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.email).toBe(parent.email);
  });

  it('two different real sessions resolve to two different, correct emails — no cross-identity bleed', () => {
    const admin = realLegacyUser('admin');
    const driver = realLegacyUser('driver');
    const adminSession = createSession({ id: admin.id, email: admin.email, role: admin.role });
    const driverSession = createSession({ id: driver.id, email: driver.email, role: driver.role });

    const adminResult = requireVerifiedEmail(`Bearer ${adminSession.token}`);
    const driverResult = requireVerifiedEmail(`Bearer ${driverSession.token}`);
    expect(adminResult.ok && adminResult.email).toBe(admin.email);
    expect(driverResult.ok && driverResult.email).toBe(driver.email);
    expect(adminResult.ok && driverResult.ok && adminResult.email !== driverResult.email).toBe(true);
  });
});

describe('requireVerifiedEmail composed with the existing role guards — the real end-to-end fix', () => {
  it('a real parent session correctly resolves through requireParentUser to exactly that parent\'s governed record', () => {
    const legacyParent = realLegacyUser('parent');
    const session = createSession({ id: legacyParent.id, email: legacyParent.email, role: legacyParent.role });
    const identity = requireVerifiedEmail(`Bearer ${session.token}`);
    expect(identity.ok).toBe(true);
    if (!identity.ok) return;
    const guard = requireParentUser(identity.email);
    expect(guard.ok).toBe(true);
    if (guard.ok) expect(guard.user.email).toBe(legacyParent.email);
  });

  it('an anonymous caller can never reach requireParentUser at all — the exact fix for the confirmed exploit', () => {
    const identity = requireVerifiedEmail(undefined);
    expect(identity.ok).toBe(false);
    // The route never even calls requireParentUser in this case — verified
    // structurally below (every governed route checks identity.ok first).
  });

  it('a driver session is correctly rejected by requireOperationalUser (admin/school only) even though the session itself is genuinely valid', () => {
    const driver = realLegacyUser('driver');
    const session = createSession({ id: driver.id, email: driver.email, role: driver.role });
    const identity = requireVerifiedEmail(`Bearer ${session.token}`);
    expect(identity.ok).toBe(true);
    if (!identity.ok) return;
    const guard = requireOperationalUser(identity.email);
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(403);
  });
});

describe('Structural regression guard — the exact exploit pattern can never silently return', () => {
  const routesDir = path.resolve(__dirname, '../../server/routes');
  const routeFiles = fs.readdirSync(routesDir).filter((f) => f.endsWith('.ts'));

  it('no governed route file reads req.query.userEmail or req.body.userEmail/req.body?.userEmail for authorization', () => {
    expect(routeFiles.length).toBeGreaterThan(5); // sanity — the inventory this phase found (11 files)
    for (const file of routeFiles) {
      const source = fs.readFileSync(path.join(routesDir, file), 'utf8');
      expect(source, `${file} still reads req.query.userEmail`).not.toMatch(/req\.query\.userEmail/);
      expect(source, `${file} still reads req.body.userEmail`).not.toMatch(/req\.body\??\.userEmail/);
    }
  });

  it('every governed route file that authorizes a caller does so via requireVerifiedEmail, not a bare req.query/req.body field', () => {
    for (const file of routeFiles) {
      const source = fs.readFileSync(path.join(routesDir, file), 'utf8');
      const usesGovernedGuard = /require(OperationalUser|ParentUser|AuthenticatedUser|TelemetryReader|JourneyReader|JourneyActor|DriverIdentity)\(/.test(source);
      if (usesGovernedGuard) {
        expect(source, `${file} calls a governed guard but never requireVerifiedEmail`).toMatch(/requireVerifiedEmail\(/);
      }
    }
  });
});
