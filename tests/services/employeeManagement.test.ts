import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { generateTemporaryPassword, hashPassword, verifyPassword } from '../../server/services/legacyAuthCredentials';
import { legacyUserRepository } from '../../server/repositories/legacyUserRepository';
import { legacyBusRepository } from '../../server/repositories/legacyBusRepository';
import { legacyStudentRepository } from '../../server/repositories/legacyStudentRepository';
import { createSession, validateSession, invalidateAllSessionsForUser, clearAllSessions } from '../../server/services/legacySessionService';
import { requireLegacyRole, LEGACY_EMPLOYEE_MANAGEMENT_ROLES, LEGACY_DATA_MANAGEMENT_ROLES } from '../../server/services/legacyAuthz';

// Phase 8B — Employee Account Management & Provisioning. Mirrors the
// existing test conventions in this codebase: direct repository/service
// tests where a real function is importable, source-scan tests over
// server.ts where the behavior only exists inside a route handler (no
// HTTP test harness exists in this codebase — server.ts never exports
// `app` — matching the precedent set by legacySessionAndAuthz.test.ts).

beforeEach(() => {
  clearAllSessions();
});

// ---------------------------------------------------------------------------
// A. Temporary credential generation — no email dependency, high entropy
// ---------------------------------------------------------------------------

describe('generateTemporaryPassword — the no-email-dependency credential mechanism', () => {
  it('returns a non-empty string, distinct on every call', () => {
    const a = generateTemporaryPassword();
    const b = generateTemporaryPassword();
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it('is long enough to satisfy the existing 8-character minimum password policy with room to spare', () => {
    const pw = generateTemporaryPassword();
    expect(pw.length).toBeGreaterThanOrEqual(10);
  });

  it('hashes and verifies correctly through the existing scrypt convention (no new comparison path)', () => {
    const pw = generateTemporaryPassword();
    const hash = hashPassword(pw);
    expect(verifyPassword(pw, hash)).toBe(true);
    expect(verifyPassword('not-the-real-temp-password', hash)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B. legacyUserRepository — new employee-provisioning fields
// ---------------------------------------------------------------------------

describe('legacyUserRepository — Phase 8B fields (status, mustChangePassword, createdByUserId)', () => {
  it('a freshly seeded demo account defaults to status=active, mustChangePassword=false, createdByUserId=null', () => {
    const admin = legacyUserRepository.findById('u-4');
    expect(admin?.status).toBe('active');
    expect(admin?.mustChangePassword).toBe(false);
    expect(admin?.createdByUserId).toBeNull();
  });

  it('create() accepts and persists the new fields for an admin-provisioned employee', () => {
    const created = legacyUserRepository.create({
      name: 'Test Driver',
      email: `test-driver-${Date.now()}@masara.om`,
      passwordHash: hashPassword(generateTemporaryPassword()),
      role: 'driver',
      status: 'active',
      mustChangePassword: true,
      createdByUserId: 'u-4',
    });
    const fetched = legacyUserRepository.findById(created.id);
    expect(fetched?.role).toBe('driver');
    expect(fetched?.mustChangePassword).toBe(true);
    expect(fetched?.createdByUserId).toBe('u-4');
  });

  it('updateStatus toggles active/disabled and persists', () => {
    const created = legacyUserRepository.create({
      name: 'Toggle Test',
      email: `toggle-${Date.now()}@masara.om`,
      passwordHash: hashPassword('irrelevant1'),
      role: 'driver',
    });
    legacyUserRepository.updateStatus(created.id, 'disabled');
    expect(legacyUserRepository.findById(created.id)?.status).toBe('disabled');
    legacyUserRepository.updateStatus(created.id, 'active');
    expect(legacyUserRepository.findById(created.id)?.status).toBe('active');
  });

  it('setMustChangePassword toggles the forced-change flag and persists', () => {
    const created = legacyUserRepository.create({
      name: 'Flag Test',
      email: `flag-${Date.now()}@masara.om`,
      passwordHash: hashPassword('irrelevant1'),
      role: 'driver',
      mustChangePassword: true,
    });
    expect(legacyUserRepository.findById(created.id)?.mustChangePassword).toBe(true);
    legacyUserRepository.setMustChangePassword(created.id, false);
    expect(legacyUserRepository.findById(created.id)?.mustChangePassword).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C. Ownership assignment primitives (legacyBusRepository/legacyStudentRepository)
// ---------------------------------------------------------------------------

describe('Ownership assignment repository primitives — the gap Phase 7K deliberately left open', () => {
  it('legacyBusRepository.updateDriverId assigns and unassigns', () => {
    const before = legacyBusRepository.findById('bus-102');
    expect(before?.driverId).toBeNull(); // seeded unassigned, per Phase 7K's seed comment

    legacyBusRepository.updateDriverId('bus-102', 'u-2');
    expect(legacyBusRepository.findById('bus-102')?.driverId).toBe('u-2');

    legacyBusRepository.updateDriverId('bus-102', null);
    expect(legacyBusRepository.findById('bus-102')?.driverId).toBeNull();
  });

  it('legacyStudentRepository.updateParentId assigns and unassigns', () => {
    const before = legacyStudentRepository.findById('std-3');
    expect(before?.parentId).toBeNull(); // seeded unassigned, per Phase 7K's seed comment

    legacyStudentRepository.updateParentId('std-3', 'u-1');
    expect(legacyStudentRepository.findById('std-3')?.parentId).toBe('u-1');

    legacyStudentRepository.updateParentId('std-3', null);
    expect(legacyStudentRepository.findById('std-3')?.parentId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// D. Deactivation must revoke every session immediately (not just block future logins)
// ---------------------------------------------------------------------------

describe('Deactivation revokes sessions immediately — the same invalidateAllSessionsForUser primitive Phase 7H established', () => {
  it('a session valid before deactivation is invalid immediately after, with no new login/logout in between', () => {
    const created = legacyUserRepository.create({
      name: 'Session Revoke Test',
      email: `revoke-${Date.now()}@masara.om`,
      passwordHash: hashPassword('irrelevant1'),
      role: 'driver',
    });
    const session = createSession({ id: created.id, email: created.email, role: created.role });
    expect(validateSession(session.token)).not.toBeNull();

    legacyUserRepository.updateStatus(created.id, 'disabled');
    invalidateAllSessionsForUser(created.id);

    expect(validateSession(session.token)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// E. Authorization scope — employee management is admin-only, narrower than data management
// ---------------------------------------------------------------------------

describe('LEGACY_EMPLOYEE_MANAGEMENT_ROLES — deliberately narrower than LEGACY_DATA_MANAGEMENT_ROLES', () => {
  it('is exactly ["admin"] — school is NOT included, unlike LEGACY_DATA_MANAGEMENT_ROLES', () => {
    expect(LEGACY_EMPLOYEE_MANAGEMENT_ROLES).toEqual(['admin']);
    expect(LEGACY_DATA_MANAGEMENT_ROLES).toContain('school');
  });

  it('a school session is rejected by LEGACY_EMPLOYEE_MANAGEMENT_ROLES (403), even though school passes LEGACY_DATA_MANAGEMENT_ROLES', () => {
    const schoolSession = createSession({ id: 'u-3', email: 'school@masara.om', role: 'school' });
    const employeeGuard = requireLegacyRole(`Bearer ${schoolSession.token}`, LEGACY_EMPLOYEE_MANAGEMENT_ROLES);
    expect(employeeGuard.ok).toBe(false);
    if (employeeGuard.ok === false) expect(employeeGuard.status).toBe(403);

    const dataGuard = requireLegacyRole(`Bearer ${schoolSession.token}`, LEGACY_DATA_MANAGEMENT_ROLES);
    expect(dataGuard.ok).toBe(true);
  });

  it('an admin session passes both guards', () => {
    const adminSession = createSession({ id: 'u-4', email: 'admin@masara.om', role: 'admin' });
    expect(requireLegacyRole(`Bearer ${adminSession.token}`, LEGACY_EMPLOYEE_MANAGEMENT_ROLES).ok).toBe(true);
    expect(requireLegacyRole(`Bearer ${adminSession.token}`, LEGACY_DATA_MANAGEMENT_ROLES).ok).toBe(true);
  });

  it('a driver/parent session is rejected by both guards', () => {
    const driverSession = createSession({ id: 'u-2', email: 'driver1@masara.om', role: 'driver' });
    expect(requireLegacyRole(`Bearer ${driverSession.token}`, LEGACY_EMPLOYEE_MANAGEMENT_ROLES).ok).toBe(false);
    expect(requireLegacyRole(`Bearer ${driverSession.token}`, LEGACY_DATA_MANAGEMENT_ROLES).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F. Source-scan governance guards — server.ts route wiring
// ---------------------------------------------------------------------------

describe('Source-scan — Phase 8B route wiring in server.ts', () => {
  const serverSource = fs.readFileSync(path.resolve(__dirname, '../../server.ts'), 'utf8');

  function routeBlock(pattern: string, endPattern: string): string {
    const start = serverSource.indexOf(pattern);
    expect(start, `route not found: ${pattern}`).toBeGreaterThan(-1);
    const end = serverSource.indexOf(endPattern, start + pattern.length);
    expect(end, `end marker not found after ${pattern}: ${endPattern}`).toBeGreaterThan(start);
    return serverSource.slice(start, end);
  }

  it('every employee-lifecycle mutation route requires LEGACY_EMPLOYEE_MANAGEMENT_ROLES', () => {
    const patterns = [
      "app.post('/api/admin/employees'",
      "app.patch('/api/admin/employees/:id/deactivate'",
      "app.patch('/api/admin/employees/:id/activate'",
      "app.post('/api/admin/employees/:id/reset-credential'",
      "app.post('/api/admin/employees/:id/revoke-sessions'",
    ];
    for (const pattern of patterns) {
      const start = serverSource.indexOf(pattern);
      expect(start, `route not found: ${pattern}`).toBeGreaterThan(-1);
      const block = serverSource.slice(start, start + 300);
      expect(block, `${pattern} does not require LEGACY_EMPLOYEE_MANAGEMENT_ROLES`).toMatch(/requireLegacyRole\([^)]*LEGACY_EMPLOYEE_MANAGEMENT_ROLES/);
    }
  });

  it('GET /api/admin/employees and GET /api/admin/parents use the wider LEGACY_DATA_MANAGEMENT_ROLES (read access), not the narrower employee-management role list', () => {
    for (const pattern of ["app.get('/api/admin/employees'", "app.get('/api/admin/parents'"]) {
      const start = serverSource.indexOf(pattern);
      expect(start, `route not found: ${pattern}`).toBeGreaterThan(-1);
      const block = serverSource.slice(start, start + 300);
      expect(block).toMatch(/requireLegacyRole\([^)]*LEGACY_DATA_MANAGEMENT_ROLES/);
    }
  });

  it('the ownership assignment routes require LEGACY_DATA_MANAGEMENT_ROLES and validate the target role server-side before writing', () => {
    const driverBlock = routeBlock("app.patch('/api/buses/:id/assign-driver'", "app.patch('/api/students/:id/assign-parent'");
    expect(driverBlock).toMatch(/requireLegacyRole\([^)]*LEGACY_DATA_MANAGEMENT_ROLES/);
    expect(driverBlock).toMatch(/driver\.role\s*!==\s*'driver'/);
    expect(driverBlock).toMatch(/driver\.status\s*!==\s*'active'/);

    const parentBlockStart = serverSource.indexOf("app.patch('/api/students/:id/assign-parent'");
    expect(parentBlockStart).toBeGreaterThan(-1);
    const parentBlock = serverSource.slice(parentBlockStart, parentBlockStart + 1500);
    expect(parentBlock).toMatch(/parent\.role\s*!==\s*'parent'/);
    expect(parentBlock).toMatch(/parent\.status\s*!==\s*'active'/);
  });

  it('the create-employee route restricts role to driver/school/admin and never accepts "parent" — self-registration stays the only parent-creation path', () => {
    const block = routeBlock("app.post('/api/admin/employees'", "app.get('/api/admin/employees'");
    expect(block).toMatch(/EMPLOYEE_ROLES/);
    // The allow-list itself must not include 'parent'.
    const rolesDeclStart = serverSource.indexOf('const EMPLOYEE_ROLES');
    expect(rolesDeclStart).toBeGreaterThan(-1);
    const rolesDecl = serverSource.slice(rolesDeclStart, rolesDeclStart + 100);
    expect(rolesDecl).not.toMatch(/'parent'/);
  });

  it('deactivate calls invalidateAllSessionsForUser — immediate revocation, not just a future-login block', () => {
    const block = routeBlock("app.patch('/api/admin/employees/:id/deactivate'", "app.patch('/api/admin/employees/:id/activate'");
    expect(block).toMatch(/invalidateAllSessionsForUser\(/);
  });

  it('reset-credential sets mustChangePassword and revokes all sessions, same as deactivate', () => {
    const block = routeBlock("app.post('/api/admin/employees/:id/reset-credential'", "app.post('/api/admin/employees/:id/revoke-sessions'");
    expect(block).toMatch(/setMustChangePassword\(id,\s*true\)/);
    expect(block).toMatch(/invalidateAllSessionsForUser\(/);
  });

  it('the login route checks disabled status only AFTER password verification (enumeration-safety ordering)', () => {
    const loginStart = serverSource.indexOf("app.post('/api/auth/login'");
    const loginEnd = serverSource.indexOf("app.post('/api/auth/logout'");
    const block = serverSource.slice(loginStart, loginEnd);
    const verifyIdx = block.indexOf('verifyPassword(password, user.passwordHash)');
    const statusIdx = block.indexOf("user.status === 'disabled'");
    expect(verifyIdx).toBeGreaterThan(-1);
    expect(statusIdx).toBeGreaterThan(-1);
    expect(verifyIdx).toBeLessThan(statusIdx);
  });

  it('a successful login response includes mustChangePassword', () => {
    const loginStart = serverSource.indexOf("app.post('/api/auth/login'");
    const loginEnd = serverSource.indexOf("app.post('/api/auth/logout'");
    const block = serverSource.slice(loginStart, loginEnd);
    expect(block).toMatch(/mustChangePassword:\s*user\.mustChangePassword/);
  });

  it('change-password clears mustChangePassword on success', () => {
    const start = serverSource.indexOf("app.post('/api/auth/change-password'");
    const end = serverSource.indexOf("// ---", start); // the Phase 8B section-divider comment right after
    expect(end).toBeGreaterThan(start);
    const block = serverSource.slice(start, end);
    expect(block).toMatch(/setMustChangePassword\(user\.id,\s*false\)/);
  });

  it('self-deactivation and last-active-admin deactivation are both explicitly blocked', () => {
    const block = routeBlock("app.patch('/api/admin/employees/:id/deactivate'", "app.patch('/api/admin/employees/:id/activate'");
    expect(block).toMatch(/target\.id === guard\.user\.id/);
    expect(block).toMatch(/activeAdmins\.length <= 1/);
  });

  it('none of the new Phase 8B routes read req.body.role/status/mustChangePassword/id as a substitute for server-side validation or the session guard', () => {
    const start = serverSource.indexOf('// Phase 8B — Employee Account Management');
    const end = serverSource.indexOf('// Phase 7A — every legacy read below');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = serverSource.slice(start, end);
    expect(block).not.toMatch(/req\.body\.status/);
    expect(block).not.toMatch(/req\.body\.mustChangePassword/);
    expect(block).not.toMatch(/req\.body\.createdByUserId/);
  });

  it('the temporary password is never logged anywhere in the Phase 8B route block', () => {
    const start = serverSource.indexOf('// Phase 8B — Employee Account Management');
    const end = serverSource.indexOf('// Phase 7A — every legacy read below');
    const block = serverSource.slice(start, end);
    expect(block).not.toMatch(/console\.(log|warn|error)\([^)]*temporaryPassword/);
  });
});
