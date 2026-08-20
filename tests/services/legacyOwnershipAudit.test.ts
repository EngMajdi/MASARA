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
// CONCLUSION: no ownership guard was added to either legacy mutation
// route (/api/buses/:id/start-route, /api/students/:id/status). The
// existing Phase 7A role matrix (LEGACY_OPERATIONAL_ROLES /
// LEGACY_ANY_ROLE, unscoped by resource) is preserved exactly. These
// tests prove that conclusion is accurate and stays accurate — they
// exist to fail loudly if a future change quietly introduces a fabricated
// relationship, not to celebrate the limitation.

describe('Phase 7I — driver->bus ownership: no authoritative relationship exists (do not fabricate)', () => {
  it('no bus record carries a driverId — only free-text driverName/driverPhone', () => {
    for (const bus of INITIAL_BUSES) {
      expect(bus).not.toHaveProperty('driverId');
      expect(typeof (bus as unknown as { driverName: unknown }).driverName).toBe('string');
    }
  });

  it('the legacy identity model has no phone column to correlate against driverPhone even if one wanted to', () => {
    const schemaSource = fs.readFileSync(path.resolve(__dirname, '../../database/schema.ts'), 'utf8');
    const start = schemaSource.indexOf('export const legacyUsers');
    const block = schemaSource.slice(start, schemaSource.indexOf(');', start));
    expect(block).not.toMatch(/phone/i);
  });

  it('server.ts documents this exact limitation on the start-route route, not silently', () => {
    const serverSource = fs.readFileSync(path.resolve(__dirname, '../../server.ts'), 'utf8');
    const idx = serverSource.indexOf("app.post('/api/buses/:id/start-route'");
    const precedingComment = serverSource.slice(Math.max(0, idx - 500), idx).replace(/\n\/\/\s*/g, ' ');
    expect(precedingComment).toMatch(/no driver identity field/);
    expect(precedingComment).toMatch(/NOT enforced/);
  });
});

describe('Phase 7I — parent->student ownership: the parentId field is decorative, never session-derived (do not fabricate)', () => {
  it('students carry a parentId field, but it is never compared against any authenticated identity in the frontend', () => {
    const student = INITIAL_STUDENTS[0];
    expect(student.parentId).toBeTruthy(); // the field exists...

    const parentPortalSource = fs.readFileSync(path.resolve(__dirname, '../../src/components/ParentPortal.tsx'), 'utf8');
    // ...but is only ever matched against a hardcoded literal, never
    // currentUser.id / currentUser.email / any session-derived value.
    expect(parentPortalSource).toMatch(/parentId\s*===\s*'par-1'/);
    expect(parentPortalSource).not.toMatch(/parentId\s*===\s*currentUser/);
  });

  it('the legacy identity id space (u-1..u-4) never overlaps the parentId id space (par-1..par-4) — confirming there is no mapping between them', () => {
    const legacyUserIds = ['u-1', 'u-2', 'u-3', 'u-4'];
    const parentIds = [...new Set(INITIAL_STUDENTS.map((s) => s.parentId))];
    for (const pid of parentIds) {
      expect(legacyUserIds).not.toContain(pid);
    }
  });

  it('server.ts documents this exact limitation on the student-status route, not silently', () => {
    const serverSource = fs.readFileSync(path.resolve(__dirname, '../../server.ts'), 'utf8');
    const idx = serverSource.indexOf("app.post('/api/students/:id/status'");
    const precedingComment = serverSource.slice(Math.max(0, idx - 500), idx).replace(/\n\/\/\s*/g, ' ');
    expect(precedingComment).toMatch(/no parent-ownership FK/);
    expect(precedingComment).toMatch(/NOT enforced/);
  });

  it('the governed side (Phase 5A) reached the same conclusion independently — prior art, not a fresh guess', () => {
    const contractSource = fs.readFileSync(path.resolve(__dirname, '../../server/domain/parentAccessContract.ts'), 'utf8');
    expect(contractSource).toMatch(/no real parent<->student relation/);
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

describe('Phase 7I — KNOWN LIMITATION, honestly proven, not hidden: cross-resource legacy mutation is not currently blocked', () => {
  // These tests do NOT assert desired behavior — they document the actual,
  // audited, unfixed limitation precisely so it cannot silently regress
  // (get worse) or silently appear fixed (someone claims it's solved when
  // it isn't) without a test failing either way.
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
// No ownership code was added. This block exists so the STOP's factual
// basis stays durable and testable, exactly like the block above.
// ---------------------------------------------------------------------------

describe('Phase 7J — STOP condition evidence: legacy buses/students remain in-memory-only, not persisted', () => {
  it('server.ts still declares buses/students as plain in-memory arrays, not backed by any repository', () => {
    const serverSource = fs.readFileSync(path.resolve(__dirname, '../../server.ts'), 'utf8');
    expect(serverSource).toMatch(/let buses = \[\.\.\.INITIAL_BUSES\]/);
    expect(serverSource).toMatch(/let students = \[\.\.\.INITIAL_STUDENTS\]/);
  });

  it('no legacy_buses or legacy_students table exists in the schema — only the unrelated, GOVERNED Journey Core buses/students tables do', () => {
    const schemaSource = fs.readFileSync(path.resolve(__dirname, '../../database/schema.ts'), 'utf8');
    expect(schemaSource).not.toMatch(/export const legacyBuses/);
    expect(schemaSource).not.toMatch(/export const legacyStudents/);
    // The governed tables exist (Journey Core, Phase 3A+) — confirming the
    // collision is real, not a naming coincidence being missed.
    expect(schemaSource).toMatch(/export const buses = sqliteTable\('buses'/);
    expect(schemaSource).toMatch(/export const students = sqliteTable\('students'/);
  });

  it('the Bus TypeScript contract has no driverId field — only display-only driverName/driverPhone/driverAvatar', () => {
    const typesSource = fs.readFileSync(path.resolve(__dirname, '../../src/types.ts'), 'utf8');
    const start = typesSource.indexOf('export interface Bus');
    const block = typesSource.slice(start, typesSource.indexOf('}', start));
    expect(block).not.toMatch(/driverId/);
    expect(block).toMatch(/driverName/);
  });

  it('no legacy repository or side-table maps a driver/parent identity to a bus/student — only the unrelated governed tripRepository.findByDriverId exists (Journey Core, not the legacy surface)', () => {
    const repoDir = path.resolve(__dirname, '../../server/repositories');
    const files = fs.readdirSync(repoDir).filter((f) => f.endsWith('.ts'));
    const matches: string[] = [];
    for (const f of files) {
      const source = fs.readFileSync(path.join(repoDir, f), 'utf8');
      if (/\b(driverId|parentId)\b/.test(source)) matches.push(f);
    }
    // Only tripRepository (governed Journey Core) is expected to reference
    // driverId; nothing legacy-surface-related should.
    expect(matches).toEqual(['tripRepository.ts']);
  });
});
