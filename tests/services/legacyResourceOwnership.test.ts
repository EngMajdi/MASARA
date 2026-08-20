import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { legacyBusRepository, type LegacyBusCreateInput } from '../../server/repositories/legacyBusRepository';
import { legacyStudentRepository, type LegacyStudentCreateInput } from '../../server/repositories/legacyStudentRepository';
import { legacyUserRepository } from '../../server/repositories/legacyUserRepository';
import { requireLegacyBusOwnership, requireLegacyStudentOwnership, type LegacySessionUser } from '../../server/services/legacyAuthz';
import { seed } from '../../database/seed/seed';
import { db } from '../../database/client';

const DRIVER1 = { id: 'u-2', email: 'driver1@masara.om', role: 'driver' } as LegacySessionUser;
const PARENT1 = { id: 'u-1', email: 'parent@masara.om', role: 'parent' } as LegacySessionUser;
const ADMIN = { id: 'u-4', email: 'admin@masara.om', role: 'admin' } as LegacySessionUser;
const SCHOOL = { id: 'u-3', email: 'school@masara.om', role: 'school' } as LegacySessionUser;

const serverSource = () => fs.readFileSync(path.resolve(__dirname, '../../server.ts'), 'utf8');

// ---------------------------------------------------------------------------
// Repository CRUD — real SQLite persistence, not an in-memory array
// ---------------------------------------------------------------------------

describe('legacyBusRepository — persistence replacing server.ts\'s old in-memory `let buses`', () => {
  it('findAll returns the 3 seeded demo buses', () => {
    const all = legacyBusRepository.findAll();
    expect(all.length).toBe(3);
    expect(all.map((b) => b.id).sort()).toEqual(['bus-101', 'bus-102', 'bus-103']);
  });

  it('findById returns the exact bus, reassembling currentLocation as a nested {lat,lng} object (API contract preserved)', () => {
    const bus = legacyBusRepository.findById('bus-101');
    expect(bus).toBeTruthy();
    expect(bus!.currentLocation).toEqual({ lat: 23.598, lng: 58.41 });
    expect(bus!.busNumber).toBe('حافلة 101');
  });

  it('findById returns undefined for a nonexistent id (no throw)', () => {
    expect(legacyBusRepository.findById('bus-does-not-exist')).toBeUndefined();
  });

  it('create() persists a new bus queryable by a fresh findById call — not just returned in-memory', () => {
    const input: LegacyBusCreateInput = {
      busNumber: 'حافلة 999',
      plateNumber: 'ت س 111',
      driverName: 'سائق تجريبي',
      driverPhone: '+968 9000 0000',
      driverAvatar: 'https://example.com/a.png',
      capacity: 30,
      currentOccupancy: 0,
      currentLocation: { lat: 23.6, lng: 58.4 },
      speedKmH: 0,
      status: 'idle',
      fuelLevel: 100,
      safetyScore: 100,
      assignedRouteId: '',
      nextStopName: 'test',
      nextStopEtaMins: 0,
    };
    const created = legacyBusRepository.create(input);
    const reread = legacyBusRepository.findById(created.id);
    expect(reread).toEqual(created);
    expect(legacyBusRepository.findAll().length).toBe(4);
  });

  it('create() always sets driverId to null, even if a caller tries to smuggle one in — no trusted assignment mechanism exists yet', () => {
    const input = {
      busNumber: 'حافلة 998',
      plateNumber: 'ت س 222',
      driverName: 'سائق آخر',
      driverPhone: '+968 9000 0001',
      driverAvatar: 'https://example.com/b.png',
      capacity: 20,
      currentOccupancy: 0,
      currentLocation: { lat: 23.6, lng: 58.4 },
      speedKmH: 0,
      status: 'idle',
      fuelLevel: 100,
      safetyScore: 100,
      assignedRouteId: '',
      nextStopName: 'test',
      nextStopEtaMins: 0,
      driverId: 'u-2', // attempted smuggling — LegacyBusCreateInput has no such field, cast to bypass the type
    } as unknown as LegacyBusCreateInput;
    const created = legacyBusRepository.create(input);
    expect(created.driverId).toBeNull();
  });

  it('deleteById removes the row and returns true; returns false for a nonexistent id', () => {
    const created = legacyBusRepository.create({
      busNumber: 'temp', plateNumber: 'x', driverName: 'x', driverPhone: 'x', driverAvatar: 'x',
      capacity: 1, currentOccupancy: 0, currentLocation: { lat: 0, lng: 0 }, speedKmH: 0,
      status: 'idle', fuelLevel: 100, safetyScore: 100, assignedRouteId: '', nextStopName: '', nextStopEtaMins: 0,
    });
    expect(legacyBusRepository.deleteById(created.id)).toBe(true);
    expect(legacyBusRepository.findById(created.id)).toBeUndefined();
    expect(legacyBusRepository.deleteById('bus-never-existed')).toBe(false);
  });

  it('updateStatus mutates status and persists it (visible on a fresh findById)', () => {
    const before = legacyBusRepository.findById('bus-103')!;
    expect(before.status).toBe('idle');
    legacyBusRepository.updateStatus('bus-103', 'en_route_pickup');
    expect(legacyBusRepository.findById('bus-103')!.status).toBe('en_route_pickup');
    legacyBusRepository.updateStatus('bus-103', 'idle'); // restore
  });
});

describe('legacyStudentRepository — persistence replacing server.ts\'s old in-memory `let students`', () => {
  it('findAll returns the 5 seeded demo students', () => {
    expect(legacyStudentRepository.findAll().length).toBe(5);
  });

  it('findById reassembles pickupPoint as a nested object (API contract preserved)', () => {
    const s = legacyStudentRepository.findById('std-1');
    expect(s!.pickupPoint).toEqual({ lat: 23.595, lng: 58.405, address: 'حي القرم، شارع النهضة', nameAr: 'نقطة توقف حي القرم (أ)' });
  });

  it('create() always sets parentId to null, ignoring the legacy "par-new" placeholder or any smuggled value', () => {
    const input = {
      name: 'طالب تجريبي', grade: 'x', avatar: 'x', schoolId: 'sch-1', schoolName: 'x',
      parentName: 'x', parentPhone: 'x', busId: 'bus-101', busNumber: 'حافلة 101',
      pickupPoint: { lat: 0, lng: 0, address: 'x', nameAr: 'x' },
      status: 'at_home', pickupTimePlanned: '07:00',
      seatNumber: '99', parentId: 'par-new',
    } as unknown as LegacyStudentCreateInput;
    const created = legacyStudentRepository.create(input);
    expect(created.parentId).toBeNull();
  });

  it('deleteById removes the row; updateStatus persists boarding status + pickupTimeActual', () => {
    const created = legacyStudentRepository.create({
      name: 'x', grade: 'x', avatar: 'x', schoolId: 'sch-1', schoolName: 'x', parentName: 'x', parentPhone: 'x',
      busId: 'bus-101', busNumber: 'حافلة 101', pickupPoint: { lat: 0, lng: 0, address: 'x', nameAr: 'x' },
      status: 'at_home', pickupTimePlanned: '07:00', seatNumber: '1',
    });
    legacyStudentRepository.updateStatus(created.id, 'boarded', '07:05');
    const updated = legacyStudentRepository.findById(created.id)!;
    expect(updated.status).toBe('boarded');
    expect(updated.pickupTimeActual).toBe('07:05');
    expect(legacyStudentRepository.deleteById(created.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Seed mapping — every driverId/parentId traces to disclosed prior art, not fabrication
// ---------------------------------------------------------------------------

describe('Phase 7K seed mapping — ownership seeded only where an already-disclosed identity correspondence exists', () => {
  it('bus-101.driverId is u-2 (driver1@masara.om) — matches its pre-existing driverName exactly', () => {
    const bus = legacyBusRepository.findById('bus-101')!;
    expect(bus.driverId).toBe('u-2');
    const driver = legacyUserRepository.findById('u-2')!;
    expect(driver.role).toBe('driver');
    expect(driver.name).toBe(bus.driverName);
  });

  it('bus-102/bus-103 are unassigned — no legacy_users row exists for driver2/driver3', () => {
    expect(legacyBusRepository.findById('bus-102')!.driverId).toBeNull();
    expect(legacyBusRepository.findById('bus-103')!.driverId).toBeNull();
  });

  it('std-1 and std-2.parentId are u-1 (parent@masara.om) — matches their pre-existing parentName exactly, same pair the governed-side Phase 5A seed already calls "the demo parent\'s children"', () => {
    const s1 = legacyStudentRepository.findById('std-1')!;
    const s2 = legacyStudentRepository.findById('std-2')!;
    expect(s1.parentId).toBe('u-1');
    expect(s2.parentId).toBe('u-1');
    const parent = legacyUserRepository.findById('u-1')!;
    expect(parent.role).toBe('parent');
    expect(parent.name).toBe(s1.parentName);
  });

  it('std-3/std-4/std-5 are unassigned — no legacy_users row exists for their parentName', () => {
    expect(legacyStudentRepository.findById('std-3')!.parentId).toBeNull();
    expect(legacyStudentRepository.findById('std-4')!.parentId).toBeNull();
    expect(legacyStudentRepository.findById('std-5')!.parentId).toBeNull();
  });

  it('every non-null driverId/parentId in the seed references a legacy_users row of the matching role (no cross-role assignment)', () => {
    for (const bus of legacyBusRepository.findAll()) {
      if (bus.driverId) expect(legacyUserRepository.findById(bus.driverId)?.role).toBe('driver');
    }
    for (const student of legacyStudentRepository.findAll()) {
      if (student.parentId) expect(legacyUserRepository.findById(student.parentId)?.role).toBe('parent');
    }
  });
});

// ---------------------------------------------------------------------------
// Ownership guards — pure, session-derived, never read req.body
// ---------------------------------------------------------------------------

describe('requireLegacyBusOwnership', () => {
  it('admin and school bypass ownership entirely (existing unrestricted behavior preserved)', () => {
    const bus = legacyBusRepository.findById('bus-102')!; // driverId null — nobody "owns" it
    expect(requireLegacyBusOwnership(ADMIN, bus).ok).toBe(true);
    expect(requireLegacyBusOwnership(SCHOOL, bus).ok).toBe(true);
  });

  it('driver1 owns bus-101: allowed', () => {
    const bus = legacyBusRepository.findById('bus-101')!;
    expect(requireLegacyBusOwnership(DRIVER1, bus).ok).toBe(true);
  });

  it('driver1 does not own bus-102 (unassigned): 403', () => {
    const bus = legacyBusRepository.findById('bus-102')!;
    const result = requireLegacyBusOwnership(DRIVER1, bus);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.status).toBe(403);
  });

  it('a parent role never passes bus ownership (parentId never equals driverId)', () => {
    const bus = legacyBusRepository.findById('bus-101')!;
    const result = requireLegacyBusOwnership(PARENT1, bus);
    expect(result.ok).toBe(false);
  });
});

describe('requireLegacyStudentOwnership', () => {
  it('admin, school, and driver all bypass ownership (existing unrestricted behavior preserved for these three roles)', () => {
    const student = legacyStudentRepository.findById('std-3')!; // parentId null — nobody "owns" it
    expect(requireLegacyStudentOwnership(ADMIN, student).ok).toBe(true);
    expect(requireLegacyStudentOwnership(SCHOOL, student).ok).toBe(true);
    expect(requireLegacyStudentOwnership(DRIVER1, student).ok).toBe(true);
  });

  it('parent1 owns std-1 and std-2: allowed', () => {
    expect(requireLegacyStudentOwnership(PARENT1, legacyStudentRepository.findById('std-1')!).ok).toBe(true);
    expect(requireLegacyStudentOwnership(PARENT1, legacyStudentRepository.findById('std-2')!).ok).toBe(true);
  });

  it('parent1 does not own std-3 (unassigned): 403', () => {
    const result = requireLegacyStudentOwnership(PARENT1, legacyStudentRepository.findById('std-3')!);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Source-scan: server.ts is wired the way the guards above assume
// ---------------------------------------------------------------------------

describe('server.ts source audit — routes actually use the persisted repositories and ownership guards', () => {
  it('no in-memory `let buses`/`let students` arrays remain (code, not comments)', () => {
    const codeLines = serverSource()
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'));
    const code = codeLines.join('\n');
    expect(code).not.toMatch(/let\s+buses\s*=/);
    expect(code).not.toMatch(/let\s+students\s*=/);
  });

  it('every /api/buses and /api/students route reads through legacyBusRepository / legacyStudentRepository', () => {
    const src = serverSource();
    expect(src).toContain('legacyBusRepository.findAll()');
    expect(src).toContain('legacyStudentRepository.findAll()');
    expect(src).toContain('legacyBusRepository.create(');
    expect(src).toContain('legacyStudentRepository.create(');
    expect(src).toContain('legacyBusRepository.deleteById(');
    expect(src).toContain('legacyStudentRepository.deleteById(');
  });

  it('start-route calls requireLegacyBusOwnership and 404s on a missing bus before checking ownership', () => {
    const src = serverSource();
    const routeSection = src.slice(src.indexOf("app.post('/api/buses/:id/start-route'"), src.indexOf("app.post('/api/students/:id/status'"));
    expect(routeSection).toContain('legacyBusRepository.findById(id)');
    expect(routeSection).toMatch(/status\(404\)/);
    expect(routeSection).toContain('requireLegacyBusOwnership(guard.user, existingBus)');
  });

  it('students/:id/status calls requireLegacyStudentOwnership and 404s on a missing student before checking ownership', () => {
    const src = serverSource();
    const routeSection = src.slice(src.indexOf("app.post('/api/students/:id/status'"), src.indexOf('// 1. AI Route Optimizer'));
    expect(routeSection).toContain('legacyStudentRepository.findById(id)');
    expect(routeSection).toMatch(/status\(404\)/);
    expect(routeSection).toContain('requireLegacyStudentOwnership(guard.user, existingStudent)');
  });

  it('the existing role guards (requireLegacyRole with DATA_MANAGEMENT/OPERATIONAL/ANY_ROLE) still run first, unchanged — ownership only narrows a role that already passed', () => {
    const src = serverSource();
    const startRouteSection = src.slice(src.indexOf("app.post('/api/buses/:id/start-route'"), src.indexOf("app.post('/api/students/:id/status'"));
    expect(startRouteSection).toContain('requireLegacyRole(req.headers.authorization, LEGACY_OPERATIONAL_ROLES)');
    const statusSection = src.slice(src.indexOf("app.post('/api/students/:id/status'"), src.indexOf('// 1. AI Route Optimizer'));
    expect(statusSection).toContain('requireLegacyRole(req.headers.authorization, LEGACY_ANY_ROLE)');
  });

  it('neither ownership-guarded route reads driverId/parentId/userId/role from req.body — identity comes only from the session', () => {
    const src = serverSource();
    const startRouteSection = src.slice(src.indexOf("app.post('/api/buses/:id/start-route'"), src.indexOf("app.post('/api/students/:id/status'"));
    expect(startRouteSection).not.toMatch(/req\.body\.(driverId|userId|role)/);
    const statusSection = src.slice(src.indexOf("app.post('/api/students/:id/status'"), src.indexOf('// 1. AI Route Optimizer'));
    // The status route destructures only `status` from the body.
    expect(statusSection).toMatch(/const\s*\{\s*status\s*\}\s*=\s*req\.body/);
    expect(statusSection).not.toMatch(/req\.body\.(parentId|userId|role)/);
  });

  it('create routes (POST /api/buses, POST /api/students) never accept a client-supplied driverId/parentId — the repositories themselves always null it out (see legacyBusRepository/legacyStudentRepository tests above)', () => {
    const src = serverSource();
    const createBusSection = src.slice(src.indexOf("app.post('/api/buses',"), src.indexOf("// Delete bus"));
    const createStudentSection = src.slice(src.indexOf("app.post('/api/students',"), src.indexOf('// Delete student'));
    expect(createBusSection).toContain('legacyBusRepository.create(req.body)');
    expect(createStudentSection).toContain('legacyStudentRepository.create(req.body)');
  });
});

// ---------------------------------------------------------------------------
// Governance/AI isolation — the new legacy persistence code never imports the governed stack
// ---------------------------------------------------------------------------

describe('Governance isolation — legacy bus/student persistence never imports governed AI/journey machinery', () => {
  const forbidden = [
    'PolicyEngine', 'ActionExecutor', 'JourneyService', 'JourneyStateMachine',
    'TelemetryIngestionService', 'EtaService', 'NotificationService', 'NotificationPolicy',
    'MasaraOperationsAgent',
  ];
  const files = [
    'server/repositories/legacyBusRepository.ts',
    'server/repositories/legacyStudentRepository.ts',
    'server/services/legacyAuthz.ts',
  ];

  for (const file of files) {
    it(`${file} imports none of the governed services`, () => {
      const src = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
      for (const name of forbidden) {
        expect(src).not.toContain(name);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Isolation from the GOVERNED buses/students tables (same-named, different store)
// ---------------------------------------------------------------------------

describe('Legacy vs governed table isolation — same names, fully separate stores', () => {
  it('legacy_buses and legacy_students are physically separate tables from the governed buses/students tables', () => {
    const tableNames = db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('buses','students','legacy_buses','legacy_students')")
      .all()
      .map((r: any) => r.name)
      .sort();
    expect(tableNames).toEqual(['buses', 'legacy_buses', 'legacy_students', 'students']);
  });

  it('legacy bus/student ids never collide with governed bus/student ids (different id generation: bus-*/std-* vs crypto.randomUUID())', () => {
    const legacyBusIds = new Set(legacyBusRepository.findAll().map((b) => b.id));
    const legacyStudentIds = new Set(legacyStudentRepository.findAll().map((s) => s.id));
    const governedBusRows = db.$client.prepare('SELECT id FROM buses').all() as { id: string }[];
    const governedStudentRows = db.$client.prepare('SELECT id FROM students').all() as { id: string }[];
    for (const row of governedBusRows) expect(legacyBusIds.has(row.id)).toBe(false);
    for (const row of governedStudentRows) expect(legacyStudentIds.has(row.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Migration correctness
// ---------------------------------------------------------------------------

describe('Migration 0012 — additive only', () => {
  it('creates legacy_buses and legacy_students with no DROP/ALTER of any existing table', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../../database/migrations/0012_dear_madame_hydra.sql'), 'utf8');
    expect(sql).toContain('CREATE TABLE `legacy_buses`');
    expect(sql).toContain('CREATE TABLE `legacy_students`');
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE/i);
  });
});

// ---------------------------------------------------------------------------
// Seed idempotency (same recurring "new table forgotten by clearAll" bug class)
// ---------------------------------------------------------------------------

describe('Seed idempotency — legacy_buses/legacy_students specifically', () => {
  it('reseeding twice does not throw and does not duplicate rows', () => {
    expect(() => seed()).not.toThrow();
    expect(() => seed()).not.toThrow();
    expect(legacyBusRepository.findAll().length).toBe(3);
    expect(legacyStudentRepository.findAll().length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Persistence beyond the app's own `db` singleton — a genuine SQLite-file
// property the old in-memory array never had. A true cross-process restart
// is proven separately by this phase's mandatory live multi-instance
// verification; this test proves the data lives in the file itself, not in
// any in-process JS reference.
// ---------------------------------------------------------------------------

describe('File-level persistence — data is readable from a second, independent SQLite connection', () => {
  it('a fresh raw connection to the same DATABASE_URL sees bus-101 with its seeded driverId', () => {
    const dbPath = process.env.DATABASE_URL!;
    const raw = new Database(dbPath, { readonly: true });
    try {
      const row = raw.prepare('SELECT id, driver_id as driverId FROM legacy_buses WHERE id = ?').get('bus-101') as any;
      expect(row.driverId).toBe('u-2');
    } finally {
      raw.close();
    }
  });
});
