import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { INITIAL_BUSES, INITIAL_STUDENTS } from '../../src/mockData';

// Phase 7I — Legacy Resource Ownership Audit. OUTCOME C: ownership does
// NOT exist in an enforceable sense for either relationship the spec asked
// about, and this phase does NOT fabricate it. Full evidence:
//
// DRIVER -> BUS: INITIAL_BUSES carries only `driverName`/`driverPhone`
// (free text) — no `driverId`. The legacy identity model
// (legacy_users, Phase 7H) has no phone column at all, so there is not
// even a phone-based correlation available (unlike the governed side's
// own demo mechanism below). Confirmed unchanged since Phase 7A's own
// audit (server.ts's start-route route comment).
//
// PARENT -> STUDENT: INITIAL_STUDENTS DOES carry a `parentId` field
// ('par-1', 'par-2', ...) that looks like a real FK — but it is never
// resolved from the authenticated session anywhere in this codebase.
// src/components/ParentPortal.tsx filters students with the LITERAL
// hardcoded string `students.filter(s => s.parentId === 'par-1')` — not
// `s.parentId === currentUser.id` or anything session-derived. legacy_users
// ids are 'u-1'..'u-4', never 'par-1' — there is no mapping between the
// two id spaces anywhere. This field is decorative demo data, not a real,
// enforceable ownership relationship — using it for authorization would
// mean gating a mutation on a hardcoded frontend constant, indistinguishable
// from fabricating the relationship ourselves.
//
// PRIOR ART (why this isn't a fresh guess): the GOVERNED side hit the
// identical wall in Phase 5A and reached the identical conclusion —
// server/domain/parentAccessContract.ts's own header comment states
// verbatim: "There is therefore no real parent<->student relation
// anywhere in this schema to build authorization on top of," resolving
// it only via an explicitly-labeled DEMO_PARENT_PHONE_BY_EMAIL constant
// (phone-number match, not an FK). That constant cannot be reused for the
// legacy surface either: it is scoped to ParentJourneyService/parentRoutes.ts
// by its own doc comment, and legacy_users has no phone column to match
// against even if it were reused.
//
// CONCLUSION (Phase 7I, at the time): no ownership guard was added to
// either legacy mutation route. The existing Phase 7A role matrix
// (LEGACY_OPERATIONAL_ROLES / LEGACY_ANY_ROLE, unscoped by resource) was
// preserved exactly.
//
// PHASE 7K UPDATE — this finding is now CLOSED, not fabricated around.
// Phase 7J's own follow-up audit found the deeper blocker: the resources
// themselves (buses/students) were never persisted at all, so there was
// no table to attach a driverId/parentId FK to (see the 7J section
// below). Phase 7K persisted them (legacy_buses/legacy_students,
// migration 0012) and THEN added the FK, seeded only where a real,
// already-disclosed name correspondence already existed between
// mockData's driverName/parentName and a legacy_users row (see
// database/seed/seed.ts's own seedLegacyBuses/seedLegacyStudents
// comments for the exact evidence — bus-101->u-2, std-1/std-2->u-1;
// everything else stays unassigned, not fabricated). The tests in this
// block are updated below to prove the NEW, real state; the mockData.ts-
// level assertions that were never about the DB seed in the first place
// (INITIAL_BUSES/INITIAL_STUDENTS are frontend fallback constants,
// unrelated to server.ts since Phase 7K's refactor) remain unchanged and
// still pass, because they were never the source of the limitation.
// See tests/services/legacyResourceOwnership.test.ts for the full new
// ownership test suite (repository CRUD, seed-mapping provenance,
// guard behavior, source-scans, isolation, persistence).

describe('Phase 7I — driver->bus ownership: no authoritative relationship exists (do not fabricate)', () => {
  it('Phase 7K: the Bus type now carries a real driverId, but mockData.ts\'s own fallback constant deliberately leaves it null (unassigned) — it is not the source of the real seeded ownership, database/seed/seed.ts is (see legacyResourceOwnership.test.ts)', () => {
    for (const bus of INITIAL_BUSES) {
      expect(bus.driverId).toBeNull();
      expect(typeof bus.driverName).toBe('string');
    }
  });

  it('the legacy identity model has no phone column to correlate against driverPhone even if one wanted to', () => {
    const schemaSource = fs.readFileSync(path.resolve(__dirname, '../../database/schema.ts'), 'utf8');
    const start = schemaSource.indexOf('export const legacyUsers');
    const block = schemaSource.slice(start, schemaSource.indexOf(');', start));
    expect(block).not.toMatch(/phone/i);
  });

  it('Phase 7K: server.ts now documents real, enforced driver ownership on the start-route route (this specific limitation is closed)', () => {
    const serverSource = fs.readFileSync(path.resolve(__dirname, '../../server.ts'), 'utf8');
    const idx = serverSource.indexOf("app.post('/api/buses/:id/start-route'");
    const precedingComment = serverSource.slice(Math.max(0, idx - 700), idx).replace(/\n\/\/\s*/g, ' ');
    expect(precedingComment).toMatch(/requireLegacyBusOwnership/);
    expect(precedingComment).not.toMatch(/NOT enforced/);
  });
});

describe('Phase 7I — parent->student ownership: the parentId field is decorative, never session-derived (do not fabricate)', () => {
  it('Phase 7K: ParentPortal.tsx now compares parentId against the real, session-derived currentUser.id (this specific limitation is closed) — the mockData.ts constant used above is unrelated frontend fallback data, unchanged and still literal', () => {
    const student = INITIAL_STUDENTS[0];
    expect(student.parentId).toBeTruthy(); // the mockData.ts fallback literal still exists, unrelated to DB seeding since Phase 7K

    const parentPortalSource = fs.readFileSync(path.resolve(__dirname, '../../src/components/ParentPortal.tsx'), 'utf8');
    expect(parentPortalSource).toMatch(/parentId\s*===\s*currentUser\?\.id/);
    expect(parentPortalSource).not.toMatch(/parentId\s*===\s*'par-1'/);
  });

  it('the legacy identity id space (u-1..u-4) never overlaps mockData.ts\'s parentId id space (par-1..par-4) — that frontend fallback constant is not, and was never meant to be, the real DB seed (see legacyResourceOwnership.test.ts for the actual seeded u-1/u-2 mapping)', () => {
    const legacyUserIds = ['u-1', 'u-2', 'u-3', 'u-4'];
    const parentIds = [...new Set(INITIAL_STUDENTS.map((s) => s.parentId))];
    for (const pid of parentIds) {
      expect(legacyUserIds).not.toContain(pid);
    }
  });

  it('Phase 7K: server.ts now documents real, enforced parent ownership on the student-status route (this specific limitation is closed)', () => {
    const serverSource = fs.readFileSync(path.resolve(__dirname, '../../server.ts'), 'utf8');
    const idx = serverSource.indexOf("app.post('/api/students/:id/status'");
    const precedingComment = serverSource.slice(Math.max(0, idx - 700), idx).replace(/\n\/\/\s*/g, ' ');
    expect(precedingComment).toMatch(/requireLegacyStudentOwnership/);
    expect(precedingComment).not.toMatch(/NOT enforced/);
  });

  it('Phase 13: the governed side now documents the real parent<->student identity bridge that replaced the Phase 5A DEMO-ONLY placeholder (this specific limitation is closed)', () => {
    const contractSource = fs.readFileSync(path.resolve(__dirname, '../../server/domain/parentAccessContract.ts'), 'utf8');
    expect(contractSource).toMatch(/legacyStudentId/);
    expect(contractSource).not.toMatch(/DEMO_PARENT_PHONE_BY_EMAIL\s*[:=]/);
  });
});

describe('Phase 7I — the current (unscoped) legacy role matrix is preserved exactly, not silently narrowed or widened', () => {
  const serverSource = fs.readFileSync(path.resolve(__dirname, '../../server.ts'), 'utf8');

  function guardFor(routeNeedle: string): string {
    const idx = serverSource.indexOf(routeNeedle);
    expect(idx).toBeGreaterThan(-1);
    const block = serverSource.slice(idx, serverSource.indexOf('\n});', idx));
    const match = block.match(/requireLegacyRole\(req\.headers\.authorization,\s*(\w+)\)/);
    return match ? match[1] : '';
  }

  it('/api/buses/:id/start-route is still LEGACY_OPERATIONAL_ROLES (admin/school/driver, unscoped by bus)', () => {
    expect(guardFor("app.post('/api/buses/:id/start-route'")).toBe('LEGACY_OPERATIONAL_ROLES');
  });

  it('/api/students/:id/status is still LEGACY_ANY_ROLE (admin/school/driver/parent, unscoped by student)', () => {
    expect(guardFor("app.post('/api/students/:id/status'")).toBe('LEGACY_ANY_ROLE');
  });

  it('/api/students, /api/buses, /api/routes (create/delete) are still LEGACY_DATA_MANAGEMENT_ROLES', () => {
    expect(guardFor("app.post('/api/students'")).toBe('LEGACY_DATA_MANAGEMENT_ROLES');
    expect(guardFor("app.delete('/api/students/:id'")).toBe('LEGACY_DATA_MANAGEMENT_ROLES');
    expect(guardFor("app.post('/api/buses'")).toBe('LEGACY_DATA_MANAGEMENT_ROLES');
    expect(guardFor("app.delete('/api/buses/:id'")).toBe('LEGACY_DATA_MANAGEMENT_ROLES');
  });
});

describe('Phase 7I — body/query spoofing has no effect on identity, role, or (non-existent) ownership enforcement', () => {
  const serverSource = fs.readFileSync(path.resolve(__dirname, '../../server.ts'), 'utf8');

  function routeBlock(routeNeedle: string): string {
    const idx = serverSource.indexOf(routeNeedle);
    expect(idx).toBeGreaterThan(-1);
    return serverSource.slice(idx, serverSource.indexOf('\n});', idx));
  }

  it('start-route never reads a driverId/userId/role field from req.body to decide authorization', () => {
    const block = routeBlock("app.post('/api/buses/:id/start-route'");
    expect(block).not.toMatch(/req\.body\.(driverId|userId|role|email)/);
  });

  it('student-status never reads a parentId/userId/role field from req.body to decide authorization (only `status`, the mutation payload itself)', () => {
    const block = routeBlock("app.post('/api/students/:id/status'");
    expect(block).not.toMatch(/req\.body\.(parentId|userId|role|email)/);
    expect(block).toMatch(/req\.body/); // does read `status` — the payload, not an identity claim
  });

  it('every legacy mutation route resolves its guard from the Authorization header, never from req.body', () => {
    const mutationRoutes = [
      "app.post('/api/students'",
      "app.delete('/api/students/:id'",
      "app.post('/api/buses'",
      "app.delete('/api/buses/:id'",
      "app.post('/api/routes'",
      "app.delete('/api/routes/:id'",
      "app.post('/api/buses/:id/start-route'",
      "app.post('/api/students/:id/status'",
    ];
    for (const routeNeedle of mutationRoutes) {
      const block = routeBlock(routeNeedle);
      const firstFewLines = block.split('\n').slice(0, 4).join('\n');
      expect(firstFewLines).toMatch(/req\.headers\.authorization/);
    }
  });
});

describe('Phase 7I — the role constants themselves stay coarse/unscoped by design; Phase 7K added a SEPARATE ownership layer on top (see legacyResourceOwnership.test.ts), it did not change these constants', () => {
  // Phase 7K update: cross-resource legacy mutation IS now blocked for
  // start-route (driver) and student-status (parent) — but via the new
  // requireLegacyBusOwnership/requireLegacyStudentOwnership guards
  // layered ON TOP of requireLegacyRole, not by narrowing
  // LEGACY_OPERATIONAL_ROLES/LEGACY_ANY_ROLE themselves. These two
  // constants remain intentionally coarse (role-only, no resource
  // parameter) — that design decision didn't change, so these specific
  // assertions about the constants still hold and still matter: they'd
  // fail loudly if a future change tried to (wrongly) solve ownership by
  // narrowing the role constant instead of using the guard layer.
  it('LEGACY_OPERATIONAL_ROLES grants every driver the same access regardless of which bus is targeted — no per-bus scoping exists in the role constant itself', () => {
    const authzSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/legacyAuthz.ts'), 'utf8');
    expect(authzSource).toMatch(/LEGACY_OPERATIONAL_ROLES = \['admin', 'school', 'driver'\]/);
    // The guard is role-only — no busId/driverId parameter exists in requireLegacyRole's signature to scope with.
    expect(authzSource).toMatch(/export function requireLegacyRole\(authorizationHeader: unknown, allowedRoles: readonly string\[\]\): LegacyAuthzGuard/);
  });

  it('LEGACY_ANY_ROLE grants every parent the same access regardless of which student is targeted — no per-student scoping exists', () => {
    const authzSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/legacyAuthz.ts'), 'utf8');
    expect(authzSource).toMatch(/LEGACY_ANY_ROLE = \['admin', 'school', 'driver', 'parent'\]/);
  });
});

// ---------------------------------------------------------------------------
// Phase 7J re-audit — same objective (persist a real driver->bus and
// parent->student relationship, enforce it server-side), one level more
// specific than Phase 7I's finding: even setting the missing-relationship
// problem aside, the RESOURCES THEMSELVES are not persisted at all.
//
// server.ts's `let buses = [...INITIAL_BUSES]` and
// `let students = [...INITIAL_STUDENTS]` are still plain, process-local,
// in-memory arrays — confirmed unchanged. There is no `legacy_buses` or
// `legacy_students` SQLite table (database/schema.ts's `buses`/`students`
// exports are the GOVERNED Journey Core tables — a different store
// entirely, same naming collision already documented for `users` vs
// `legacy_users`). Persisting a driverId/parentId FK column would require
// a column on a table that does not exist; the honest additive migration
// this phase could safely make (one new column) is not actually available
// without first persisting the entire legacy bus/student resource model —
// a data-layer redesign explicitly out of scope, per the phase's own STOP
// condition ("if buses/students remain in-memory-only data structures,
// STOP... do not silently redesign the data layer").
//
// PHASE 7K UPDATE — this STOP condition is now CLOSED. Phase 7K persisted
// the legacy bus/student resource model (legacy_buses/legacy_students,
// migration 0012, server/repositories/legacyBusRepository.ts +
// legacyStudentRepository.ts), removed server.ts's in-memory arrays
// entirely, and only THEN added the driverId/parentId FK the earlier
// STOP correctly said had no honest table to attach to. The tests below
// are updated to prove the new, real state; they remain in this file
// (rather than being deleted) so the STOP's original factual basis and
// its resolution are both visible in one place.
// ---------------------------------------------------------------------------

describe('Phase 7J->7K — RESOLVED: legacy buses/students are now persisted, not in-memory-only', () => {
  it('server.ts no longer declares buses/students as in-memory arrays — both routes through legacyBusRepository/legacyStudentRepository', () => {
    const serverSource = fs.readFileSync(path.resolve(__dirname, '../../server.ts'), 'utf8');
    const codeLines = serverSource.split('\n').filter((l) => !l.trim().startsWith('//'));
    const code = codeLines.join('\n');
    expect(code).not.toMatch(/let\s+buses\s*=\s*\[\.\.\.INITIAL_BUSES\]/);
    expect(code).not.toMatch(/let\s+students\s*=\s*\[\.\.\.INITIAL_STUDENTS\]/);
    expect(serverSource).toContain("import { legacyBusRepository");
    expect(serverSource).toContain("import { legacyStudentRepository");
  });

  it('legacy_buses and legacy_students tables now exist in the schema, distinct from the GOVERNED Journey Core buses/students tables (same naming collision, now two real tables on both sides)', () => {
    const schemaSource = fs.readFileSync(path.resolve(__dirname, '../../database/schema.ts'), 'utf8');
    expect(schemaSource).toMatch(/export const legacyBuses = sqliteTable\('legacy_buses'/);
    expect(schemaSource).toMatch(/export const legacyStudents = sqliteTable\('legacy_students'/);
    // The governed tables still exist too — confirming this is a real,
    // deliberate two-sided collision, not a rename of the governed ones.
    expect(schemaSource).toMatch(/export const buses = sqliteTable\('buses'/);
    expect(schemaSource).toMatch(/export const students = sqliteTable\('students'/);
  });

  it('the Bus TypeScript contract now has a real driverId field (nullable — unassigned is honest, not fabricated)', () => {
    const typesSource = fs.readFileSync(path.resolve(__dirname, '../../src/types.ts'), 'utf8');
    const start = typesSource.indexOf('export interface Bus');
    const block = typesSource.slice(start, typesSource.indexOf('}', start));
    expect(block).toMatch(/driverId:\s*string\s*\|\s*null/);
  });

  it('legacyBusRepository.ts and legacyStudentRepository.ts now map driver/parent identity to a bus/student — tripRepository (governed Journey Core) is no longer the only one', () => {
    const repoDir = path.resolve(__dirname, '../../server/repositories');
    const files = fs.readdirSync(repoDir).filter((f) => f.endsWith('.ts'));
    const matches: string[] = [];
    for (const f of files) {
      const source = fs.readFileSync(path.join(repoDir, f), 'utf8');
      if (/\b(driverId|parentId)\b/.test(source)) matches.push(f);
    }
    expect(matches.sort()).toEqual(['legacyBusRepository.ts', 'legacyStudentRepository.ts', 'tripRepository.ts']);
  });
});
