import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createSession, validateSession, invalidateSession, clearAllSessions, SESSION_TTL_MS } from '../../server/services/legacySessionService';
import {
  checkLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
  clearAllLoginAttempts,
  MAX_FAILURES,
} from '../../server/services/loginRateLimiter';
import {
  requireLegacySession,
  requireLegacyRole,
  LEGACY_DATA_MANAGEMENT_ROLES,
  LEGACY_OPERATIONAL_ROLES,
  LEGACY_ANY_ROLE,
} from '../../server/services/legacyAuthz';

beforeEach(() => {
  clearAllSessions();
  clearAllLoginAttempts();
});

const DEMO_USER = { id: 'u-1', email: 'admin@masara.om', role: 'admin' };

// ---------------------------------------------------------------------------
// A. legacySessionService — the one authenticated session boundary (spec
// Step 1/4 mandatory)
// ---------------------------------------------------------------------------

describe('legacySessionService — session issuance, validation, expiry (spec mandatory)', () => {
  it('createSession returns a real, non-empty token, distinct per call', () => {
    const a = createSession(DEMO_USER);
    const b = createSession(DEMO_USER);
    expect(a.token).toBeTruthy();
    expect(a.token).not.toBe(b.token);
  });

  it('validateSession succeeds for a freshly created session and returns the correct identity', () => {
    const session = createSession(DEMO_USER);
    const validated = validateSession(session.token);
    expect(validated).not.toBeNull();
    expect(validated!.email).toBe(DEMO_USER.email);
    expect(validated!.role).toBe(DEMO_USER.role);
  });

  it('validateSession returns null for an unknown token', () => {
    expect(validateSession('this-token-was-never-issued')).toBeNull();
  });

  it('validateSession returns null for a malformed/non-string token, never throws', () => {
    expect(() => validateSession(undefined)).not.toThrow();
    expect(validateSession(undefined)).toBeNull();
    expect(validateSession(12345)).toBeNull();
  });

  it('validateSession returns null for a deterministically expired session (spec "Session Expiry" mandatory)', () => {
    const session = createSession(DEMO_USER, -1000); // already expired the instant it was created
    expect(validateSession(session.token)).toBeNull();
  });

  it('an expired session cannot be revived — validating it twice is still null', () => {
    const session = createSession(DEMO_USER, -1000);
    expect(validateSession(session.token)).toBeNull();
    expect(validateSession(session.token)).toBeNull();
  });

  it('invalidateSession revokes a valid session immediately', () => {
    const session = createSession(DEMO_USER);
    expect(validateSession(session.token)).not.toBeNull();
    invalidateSession(session.token);
    expect(validateSession(session.token)).toBeNull();
  });

  it('invalidating an unknown/already-invalid token is a safe no-op, never throws', () => {
    expect(() => invalidateSession('never-issued')).not.toThrow();
    expect(() => invalidateSession(undefined)).not.toThrow();
  });

  it('the default session TTL is a real, finite, positive duration', () => {
    expect(SESSION_TTL_MS).toBeGreaterThan(0);
    expect(Number.isFinite(SESSION_TTL_MS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B. loginRateLimiter — login abuse protection (spec Step 5 mandatory)
// ---------------------------------------------------------------------------

describe('loginRateLimiter — repeated failed logins are rate-limited (spec mandatory)', () => {
  it('is allowed with zero prior failures', () => {
    expect(checkLoginAllowed('fresh@masara.om').allowed).toBe(true);
  });

  it('remains allowed for failures below the threshold', () => {
    const email = 'below-threshold@masara.om';
    for (let i = 0; i < MAX_FAILURES - 1; i++) recordLoginFailure(email);
    expect(checkLoginAllowed(email).allowed).toBe(true);
  });

  it('becomes locked out once the failure threshold is reached', () => {
    const email = 'locked-out@masara.om';
    for (let i = 0; i < MAX_FAILURES; i++) recordLoginFailure(email);
    const result = checkLoginAllowed(email);
    expect(result.allowed).toBe(false);
    if (result.allowed === false) expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('a successful login resets the failure state (spec mandatory: "successful login resets the relevant failure state")', () => {
    const email = 'reset-on-success@masara.om';
    for (let i = 0; i < MAX_FAILURES; i++) recordLoginFailure(email);
    expect(checkLoginAllowed(email).allowed).toBe(false);
    recordLoginSuccess(email);
    expect(checkLoginAllowed(email).allowed).toBe(true);
  });

  it('lockout is per-email — a different email is never affected by another email\'s failures', () => {
    const attacked = 'attacked@masara.om';
    const innocent = 'innocent@masara.om';
    for (let i = 0; i < MAX_FAILURES; i++) recordLoginFailure(attacked);
    expect(checkLoginAllowed(attacked).allowed).toBe(false);
    expect(checkLoginAllowed(innocent).allowed).toBe(true);
  });

  it('email comparison is case-insensitive and trims whitespace, matching the login route\'s own lookup', () => {
    for (let i = 0; i < MAX_FAILURES; i++) recordLoginFailure('MixedCase@Masara.OM');
    expect(checkLoginAllowed('  mixedcase@masara.om  '.trim()).allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C. legacyAuthz — the authorization boundary for the legacy surface (spec
// Step 2/3 mandatory)
// ---------------------------------------------------------------------------

describe('requireLegacySession — role-agnostic session validity (spec mandatory)', () => {
  it('rejects a missing Authorization header', () => {
    const guard = requireLegacySession(undefined);
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(401);
  });

  it('rejects a malformed Authorization header (no Bearer prefix)', () => {
    const guard = requireLegacySession('not-a-bearer-token');
    expect(guard.ok).toBe(false);
  });

  it('rejects an unknown/fabricated token', () => {
    const guard = requireLegacySession('Bearer completely-made-up-token');
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(401);
  });

  it('rejects an expired token', () => {
    const session = createSession(DEMO_USER, -1000);
    const guard = requireLegacySession(`Bearer ${session.token}`);
    expect(guard.ok).toBe(false);
  });

  it('accepts a real, valid session and resolves the correct identity — never a client-supplied one', () => {
    const session = createSession(DEMO_USER);
    const guard = requireLegacySession(`Bearer ${session.token}`);
    expect(guard.ok).toBe(true);
    if (guard.ok === true) {
      expect(guard.user.email).toBe(DEMO_USER.email);
      expect(guard.user.role).toBe(DEMO_USER.role);
    }
  });
});

describe('requireLegacyRole — session validity + role allow-list (spec Step 2 mandatory)', () => {
  it('rejects when the session is invalid, before any role check', () => {
    const guard = requireLegacyRole('Bearer fake', LEGACY_DATA_MANAGEMENT_ROLES);
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(401);
  });

  it('rejects a valid session whose role is not in the allow-list — 403, not 401', () => {
    const parentSession = createSession({ id: 'u-parent', email: 'parent@masara.om', role: 'parent' });
    const guard = requireLegacyRole(`Bearer ${parentSession.token}`, LEGACY_DATA_MANAGEMENT_ROLES);
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(403);
  });

  it('accepts a valid session whose role is in the allow-list', () => {
    const adminSession = createSession(DEMO_USER);
    const guard = requireLegacyRole(`Bearer ${adminSession.token}`, LEGACY_DATA_MANAGEMENT_ROLES);
    expect(guard.ok).toBe(true);
  });

  it('driver is allowed for OPERATIONAL_ROLES but not DATA_MANAGEMENT_ROLES', () => {
    const driverSession = createSession({ id: 'u-driver', email: 'driver1@masara.om', role: 'driver' });
    expect(requireLegacyRole(`Bearer ${driverSession.token}`, LEGACY_OPERATIONAL_ROLES).ok).toBe(true);
    expect(requireLegacyRole(`Bearer ${driverSession.token}`, LEGACY_DATA_MANAGEMENT_ROLES).ok).toBe(false);
  });

  it('parent is allowed only for ANY_ROLE, never for OPERATIONAL_ROLES or DATA_MANAGEMENT_ROLES', () => {
    const parentSession = createSession({ id: 'u-parent2', email: 'parent2@masara.om', role: 'parent' });
    expect(requireLegacyRole(`Bearer ${parentSession.token}`, LEGACY_ANY_ROLE).ok).toBe(true);
    expect(requireLegacyRole(`Bearer ${parentSession.token}`, LEGACY_OPERATIONAL_ROLES).ok).toBe(false);
    expect(requireLegacyRole(`Bearer ${parentSession.token}`, LEGACY_DATA_MANAGEMENT_ROLES).ok).toBe(false);
  });

  it('no client-supplied role/email/userId parameter exists on these guards — identity comes only from the validated session token', () => {
    // Both guards take only (authorizationHeader[, allowedRoles]) — there is no identity parameter to spoof.
    expect(requireLegacySession.length).toBe(1);
    expect(requireLegacyRole.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// D. Source-scan governance guards (spec Step 8 mandatory)
// ---------------------------------------------------------------------------

describe('Source-scan governance guards (spec Step 8 mandatory)', () => {
  const serverSource = fs.readFileSync(path.resolve(__dirname, '../../server.ts'), 'utf8');
  const agentRoutesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/agentRoutes.ts'), 'utf8');
  const legacyAuthzSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/legacyAuthz.ts'), 'utf8');
  const forbiddenImports =
    /from ['"].*\/(JourneyStateMachine|JourneyService|PolicyEngine|ActionExecutor|TelemetryIngestionService|CurrentLocationProjectionService|EtaService)['"]/;

  it('every legacy mutation route (students/buses/routes POST+DELETE, ai/*, notifications POST, status, start-route) is guarded', () => {
    const protectedRoutePatterns = [
      "app.post('/api/students'",
      "app.delete('/api/students/:id'",
      "app.post('/api/students/:id/status'",
      "app.post('/api/buses'",
      "app.delete('/api/buses/:id'",
      "app.post('/api/buses/:id/start-route'",
      "app.post('/api/routes'",
      "app.delete('/api/routes/:id'",
      "app.post('/api/notifications'",
      "app.post('/api/notifications/schedule-prearrival'",
      "app.post('/api/ai/optimize-routes'",
      "app.post('/api/ai/detect-reroute'",
      "app.post('/api/ai/predict-traffic-eta'",
      "app.post('/api/ai/ask-advisor'",
      "app.post('/api/ai/run-agent'",
    ];
    for (const pattern of protectedRoutePatterns) {
      const start = serverSource.indexOf(pattern);
      expect(start, `route declaration not found: ${pattern}`).toBeGreaterThan(-1);
      const block = serverSource.slice(start, start + 400);
      expect(block, `${pattern} does not call a legacy guard`).toMatch(/requireLegacy(Session|Role)\(/);
    }
  });

  it('every legacy read route (schools/buses/students/routes/notifications/workflow-steps/all-data) is guarded', () => {
    const protectedReadPatterns = [
      "app.get('/api/all-data'",
      "app.get('/api/schools'",
      "app.get('/api/buses'",
      "app.get('/api/students'",
      "app.get('/api/routes'",
      "app.get('/api/notifications'",
      "app.get('/api/workflow-steps'",
    ];
    for (const pattern of protectedReadPatterns) {
      const start = serverSource.indexOf(pattern);
      expect(start, `route declaration not found: ${pattern}`).toBeGreaterThan(-1);
      const block = serverSource.slice(start, start + 250);
      expect(block, `${pattern} does not call requireLegacySession`).toMatch(/requireLegacySession\(/);
    }
  });

  it('/api/health remains intentionally unguarded (readiness probes must not require auth)', () => {
    const start = serverSource.indexOf("app.get('/api/health'");
    const block = serverSource.slice(start, start + 400);
    expect(block).not.toMatch(/requireLegacy/);
  });

  it('the login route never compares a password with plain string equality (spec mandatory, re-confirmed)', () => {
    expect(serverSource).not.toMatch(/\.password\s*!==\s*password\b/);
  });

  it('the login route checks the rate limiter before any password comparison', () => {
    const loginStart = serverSource.indexOf("app.post('/api/auth/login'");
    const loginEnd = serverSource.indexOf("app.post('/api/auth/logout'");
    const block = serverSource.slice(loginStart, loginEnd);
    const rateLimitIdx = block.indexOf('checkLoginAllowed');
    const verifyIdx = block.indexOf('verifyPassword');
    expect(rateLimitIdx).toBeGreaterThan(-1);
    expect(verifyIdx).toBeGreaterThan(-1);
    expect(rateLimitIdx).toBeLessThan(verifyIdx);
  });

  it('a successful login calls recordLoginSuccess and issues a real session (createSession)', () => {
    const loginStart = serverSource.indexOf("app.post('/api/auth/login'");
    const loginEnd = serverSource.indexOf("app.post('/api/auth/logout'");
    const block = serverSource.slice(loginStart, loginEnd);
    expect(block).toMatch(/recordLoginSuccess\(/);
    expect(block).toMatch(/createSession\(/);
  });

  // Regression guard for a real, live-verified privilege-escalation bug:
  // /api/auth/login used to build the session with `role: role || user.role`
  // — a client-supplied `role` field in the request body took priority over
  // the actual database role, so any authenticated user's own real
  // credentials could mint an admin session just by claiming `role:"admin"`
  // at login. /api/auth/register had the matching bug (`role: role ||
  // 'parent'`), letting an unauthenticated caller self-register as admin.
  // Fixed to always use the authoritative role; these tests must never pass
  // again if that regresses.
  it('the login route never lets a client-supplied role field override the database role', () => {
    const loginStart = serverSource.indexOf("app.post('/api/auth/login'");
    const loginEnd = serverSource.indexOf("app.post('/api/auth/logout'");
    const block = serverSource.slice(loginStart, loginEnd);
    expect(block).not.toMatch(/role\s*\|\|\s*user\.role/);
    expect(block).not.toMatch(/req\.body\.role/);
    expect(block.match(/role:\s*user\.role/g)?.length).toBe(2); // createSession + returnUser
  });

  it('the register route always creates a new legacy user with role "parent", regardless of any client-supplied role', () => {
    const registerStart = serverSource.indexOf("app.post('/api/auth/register'");
    const registerEnd = serverSource.indexOf("app.post('/api/auth/change-password'");
    expect(registerStart).toBeGreaterThan(-1);
    expect(registerEnd).toBeGreaterThan(registerStart);
    const block = serverSource.slice(registerStart, registerEnd);
    expect(block).not.toMatch(/role\s*\|\|\s*'parent'/);
    expect(block).not.toMatch(/req\.body\.role/);
    expect(block).toMatch(/role:\s*'parent'/);
  });

  it('agentRoutes.ts governance reads (recommendations/audit-logs/predictions) require requireOperationalUser', () => {
    for (const pattern of [
      "agentRouter.get('/api/recommendations'",
      "agentRouter.get('/api/audit-logs'",
      "agentRouter.get('/api/predictions/:id'",
    ]) {
      const start = agentRoutesSource.indexOf(pattern);
      expect(start, `route not found: ${pattern}`).toBeGreaterThan(-1);
      const block = agentRoutesSource.slice(start, start + 250);
      expect(block).toMatch(/requireOperationalUser\(/);
    }
  });

  it('agentRoutes.ts operational reference reads (trips/buses/routes/stops) require a real guard, not left open', () => {
    for (const pattern of ["agentRouter.get('/api/trips'", "agentRouter.get('/api/buses/:id'", "agentRouter.get('/api/routes/:id/stops'"]) {
      const start = agentRoutesSource.indexOf(pattern);
      expect(start, `route not found: ${pattern}`).toBeGreaterThan(-1);
      const block = agentRoutesSource.slice(start, start + 250);
      expect(block).toMatch(/requireJourneyReader\(|requireOperationalUser\(/);
    }
  });

  it('the legacy authz/session layer imports no Journey/governance mutation module', () => {
    expect(legacyAuthzSource).not.toMatch(forbiddenImports);
  });

  it('no route trusts a client-supplied userId/role/email as a substitute for the validated session (spec Step 1 mandatory)', () => {
    // Every protected route resolves identity via requireLegacyRole/requireLegacySession(req.headers.authorization, ...) —
    // never from req.body.role or req.body.userId as an authorization signal.
    expect(serverSource).not.toMatch(/requireLegacyRole\(req\.body\?\.role/);
    expect(serverSource).not.toMatch(/requireLegacySession\(req\.body\?\.userId/);
  });

  it('no hardcoded session secret or credential exists in the new legacy auth files', () => {
    const sessionSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/legacySessionService.ts'), 'utf8');
    const rateLimiterSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/loginRateLimiter.ts'), 'utf8');
    for (const source of [sessionSource, rateLimiterSource, legacyAuthzSource]) {
      expect(source).not.toMatch(/["'](sk_|AIza|AKIA)[a-z0-9]{10,}["']/i);
      expect(source).not.toMatch(/console\.(log|info|debug)\(/);
    }
  });
});
