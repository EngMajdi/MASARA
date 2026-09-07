import 'dotenv/config';
import { randomBytes, scryptSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db } from '../client';
import {
  schools,
  users,
  drivers,
  buses,
  students,
  routes,
  routeStops,
  trips,
  boardingEvents,
  incidents,
  predictions,
  aiRecommendations,
  actions,
  actionVerifications,
  auditLogs,
  journeys,
  telemetryObservations,
  telemetryDevices,
  currentLocationProjection,
  etaAccuracyObservations,
  notifications,
  userContacts,
  legacyUsers,
  legacyBuses,
  legacyStudents,
} from '../schema';
import { normalizeContactValue } from '../../server/services/ContactNormalization';
import { userContactRepository } from '../../server/repositories/userContactRepository';

// Deterministic synthetic data only — no real children's information (spec §7/§17).

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function clearAll() {
  // Deepest children first, respecting FK order.
  // Phase 4B: telemetry_observations references telemetry_devices, buses,
  // and trips — must go before all three; telemetry_devices references
  // buses — must go before buses (this exact bug class — a new table
  // forgotten by clearAll — has recurred every phase that added one; see
  // tests/database/seedIdempotency.test.ts, extended again for this table).
  // Phase 4C: current_location_projection references buses and trips —
  // must go before both too (same recurring bug class, guarded again).
  // Phase 4E: eta_accuracy_observations references trips, buses, and
  // route_stops — must go before all three (same recurring bug class,
  // guarded again).
  // Phase 5B: notifications references users, students, journeys, and
  // trips — must go before all four (same recurring bug class, guarded
  // again).
  // Phase 6A: user_contacts references users — must go before it (same
  // recurring bug class, guarded again).
  // Phase 7K: legacy_buses/legacy_students both carry a real FK to
  // legacy_users (driverId/parentId) — unlike legacy_sessions/
  // legacy_login_attempts, which stayed deliberately unconstrained. Both
  // must be cleared BEFORE legacy_users or the delete below throws a FK
  // constraint violation (foreign_keys=ON). Same recurring "new table
  // forgotten by clearAll" bug class flagged throughout this function —
  // guarded again here.
  //
  // Phase 13: governed `students` now carries a real FK
  // (legacyStudentId -> legacy_students.id), so this whole legacy block
  // must additionally move to AFTER the governed `students` delete below
  // — the reverse of the ordering that was correct before this column
  // existed. Kept right before legacy_users for the same reason the
  // Phase 7H comment below already explains.
  db.delete(userContacts).run();
  db.delete(notifications).run();
  db.delete(etaAccuracyObservations).run();
  db.delete(currentLocationProjection).run();
  db.delete(telemetryObservations).run();
  db.delete(telemetryDevices).run();
  db.delete(auditLogs).run();
  db.delete(actionVerifications).run();
  db.delete(actions).run();
  db.delete(aiRecommendations).run();
  db.delete(predictions).run();
  db.delete(incidents).run();
  db.delete(boardingEvents).run();
  db.delete(journeys).run();
  db.delete(trips).run();
  db.delete(routeStops).run();
  db.delete(routes).run();
  db.delete(students).run();
  // Phase 7H: legacy_sessions/legacy_login_attempts stayed deliberately
  // unconstrained against legacy_users (see that table's own schema
  // comment), so only legacy_buses/legacy_students below actually gate
  // this delete. legacy_users IS seed data (unlike those two, which are
  // pure runtime state seed.ts never touches) and was the exact "new
  // table forgotten by clearAll" bug this comment block already warns
  // about, caught by tests/database/seedIdempotency.test.ts exactly as
  // designed.
  db.delete(legacyStudents).run();
  db.delete(legacyBuses).run();
  db.delete(legacyUsers).run();
  db.delete(buses).run();
  db.delete(drivers).run();
  db.delete(users).run();
  db.delete(schools).run();
}

const FIRST_NAMES = [
  'محمد', 'أحمد', 'سالم', 'خالد', 'ناصر', 'سعيد', 'يوسف', 'عبدالله', 'راشد', 'حمد',
  'مريم', 'فاطمة', 'عائشة', 'سارة', 'ريم', 'خولة', 'منى', 'هدى', 'لطيفة', 'شيخة',
];
const FAMILY_NAMES = [
  'البوسعيدي', 'المعمري', 'الهنائي', 'الكندي', 'الحارثي', 'الرواحي', 'السعدي', 'الشحي', 'اليعقوبي', 'الفارسي',
];
const GRADES = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع'];

function studentName(i: number): string {
  return `${FIRST_NAMES[i % FIRST_NAMES.length]} بن ${FAMILY_NAMES[(i * 3 + 1) % FAMILY_NAMES.length]} ${FAMILY_NAMES[(i * 7 + 2) % FAMILY_NAMES.length]}`;
}

function parentName(i: number): string {
  return `ولي أمر ${FAMILY_NAMES[(i * 5 + 3) % FAMILY_NAMES.length]}`;
}

// Phase 15.5 — Cloud Pilot Readiness (spec §8/§34): this seed is fully
// destructive (clearAll() below wipes every table) and plants ~50 demo
// accounts sharing one hardcoded password. That is correct and unchanged
// for local dev/test. It must never run against a real pilot database —
// see database/seed/genesis.ts for the real, non-destructive bootstrap
// path. This is the one minimal guard against the single most
// catastrophic operator mistake (running this by habit against a live
// pilot): it refuses in production unless explicitly overridden, and does
// nothing else differently — no behavior change for dev/test.
function assertSafeToRunDestructiveSeed() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DESTRUCTIVE_SEED !== 'true') {
    throw new Error(
      'Refusing to run the destructive dev/test seed (database/seed/seed.ts) with NODE_ENV=production. ' +
        'This would permanently delete all existing data, including any real pilot data. ' +
        'For a real pilot\'s one-time bootstrap, use database/seed/genesis.ts instead. ' +
        'If you truly intend to wipe this database, set ALLOW_DESTRUCTIVE_SEED=true explicitly.'
    );
  }
}

export function seed() {
  assertSafeToRunDestructiveSeed();
  clearAll();

  const school = {
    id: crypto.randomUUID(),
    nameAr: 'مدرسة مسارَا التجريبية - القرم (مسقط)',
    nameEn: 'MASARA Pilot School - Qurum, Muscat',
    lat: 23.6015,
    lng: 58.421,
    address: 'شارع السلطان قابوس، حي القرم، مسقط',
    startTime: '07:00',
    endTime: '13:30',
  };
  db.insert(schools).values(school).run();

  const seedUsers = [
    { id: crypto.randomUUID(), schoolId: school.id, name: 'المشرف العام - مسارَا', email: 'admin@masara.om', role: 'admin' },
    { id: crypto.randomUUID(), schoolId: school.id, name: 'إدارة مدرسة مسارَا التجريبية', email: 'school@masara.om', role: 'school' },
    { id: crypto.randomUUID(), schoolId: school.id, name: 'الكابتن سعيد بن حمد البوسعيدي', email: 'driver1@masara.om', role: 'driver' },
    { id: crypto.randomUUID(), schoolId: school.id, name: 'الكابتن سالم بن خلفان المعمري', email: 'driver2@masara.om', role: 'driver' },
    { id: crypto.randomUUID(), schoolId: school.id, name: 'الكابتن ناصر بن راشد الهنائي', email: 'driver3@masara.om', role: 'driver' },
    // Phase 5A — closes the one gap seed.ts's own prior comment already
    // flagged: admin/school/driver1 were deliberately aligned with the
    // legacy in-memory login store (server.ts) "by design"; parent was not.
    // Same name/email as server.ts's legacy parent@masara.om row, so the
    // Parent Trust Read Model resolves to a real governed identity.
    { id: crypto.randomUUID(), schoolId: school.id, name: 'أحمد بن سيف البوسعيدي', email: 'parent@masara.om', role: 'parent' },
  ].map((u) => ({ ...u, passwordHash: hashPassword('password123') }));
  db.insert(users).values(seedUsers).run();

  // Phase 7H — the legacy identity store (server.ts's `/api/auth/*`
  // routes) was moved from an in-memory array to this table so a password
  // change is visible across every server process, not just the one that
  // handled the request. Same 4 fixed ids server.ts's array always used
  // (u-1..u-4) — every existing session/test/fixture that already
  // references these ids keeps working unchanged. Deliberately a
  // SEPARATE row set from the governed `users` table above (same
  // email-per-account, different id namespace) — this reseeds the exact
  // pre-existing legacy store, it does not unify the two identity models.
  const seedLegacyUsers = [
    { id: 'u-1', name: 'أحمد بن سيف البوسعيدي', email: 'parent@masara.om', role: 'parent' },
    { id: 'u-2', name: 'الكابتن سعيد بن حمد البوسعيدي', email: 'driver1@masara.om', role: 'driver' },
    { id: 'u-3', name: 'إدارة مدرسة المسار الدولية (مسقط)', email: 'school@masara.om', role: 'school' },
    { id: 'u-4', name: 'المشرف العام - مركز مسارَا الذكي', email: 'admin@masara.om', role: 'admin' },
  ].map((u) => ({ ...u, passwordHash: hashPassword('password123') }));
  db.insert(legacyUsers).values(seedLegacyUsers).run();

  // Phase 7K — legacy_buses/legacy_students seed. IDs match
  // src/mockData.ts's INITIAL_BUSES/INITIAL_STUDENTS exactly
  // (bus-101..103, std-1..5) since several frontend components fall back
  // to those literal strings (e.g. DataManagementModal.tsx's
  // `useState(buses[0]?.id || 'bus-101')`, ParentPortal.tsx's
  // `students[0]?.id || 'std-1'`) — preserving them keeps every existing
  // fallback path working unchanged.
  //
  // driverId/parentId ownership is seeded ONLY where a real, ALREADY
  // DISCLOSED correspondence exists between mockData's free-text
  // driverName/parentName and a legacy_users row — never invented:
  //   - bus-101.driverId = 'u-2' (driver1@masara.om): mockData's
  //     driverName for bus-101 ("الكابتن سعيد بن حمد البوسعيدي") is a
  //     byte-for-byte match of legacy_users u-2's name, and this exact
  //     pairing is the same one this file's own seedUsers comment above
  //     already documents as "deliberately aligned... by design".
  //   - std-1.parentId = std-2.parentId = 'u-1' (parent@masara.om):
  //     mockData's parentName for both ("أحمد بن سيف البوسعيدي") matches
  //     legacy_users u-1's name exactly, and the governed-side seed above
  //     (studentDefs, `isDemoParentChild = i === 0 || i === 1`) already
  //     documents these as "the demo parent's children" for the exact
  //     same real identity.
  //   - bus-102/bus-103 (driver2/driver3) and std-3/std-4/std-5 (their
  //     parents) have NO corresponding legacy_users row at all — only
  //     u-1..u-4 were ever seeded there (Phase 7H) — so there is no
  //     honest value to assign; left NULL (unassigned) rather than
  //     fabricated.
  const seedLegacyBuses = [
    {
      id: 'bus-101',
      busNumber: 'حافلة 101',
      plateNumber: 'ط ع 4589',
      driverId: 'u-2',
      driverName: 'الكابتن سعيد بن حمد البوسعيدي',
      driverPhone: '+968 9123 4567',
      driverAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
      capacity: 24,
      currentOccupancy: 18,
      currentLat: 23.598,
      currentLng: 58.41,
      speedKmH: 42,
      status: 'en_route_school',
      fuelLevel: 88,
      safetyScore: 98,
      assignedRouteId: 'route-101',
      nextStopName: 'حي القرم - المجمع السكني',
      nextStopEtaMins: 4,
    },
    {
      id: 'bus-102',
      busNumber: 'حافلة 102',
      plateNumber: 'م ص 1234',
      driverId: null,
      driverName: 'الكابتن سالم بن خلفان المعمري',
      driverPhone: '+968 9555 6677',
      driverAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200',
      capacity: 20,
      currentOccupancy: 15,
      currentLat: 23.612,
      currentLng: 58.21,
      speedKmH: 38,
      status: 'en_route_pickup',
      fuelLevel: 75,
      safetyScore: 95,
      assignedRouteId: 'route-102',
      nextStopName: 'حي الخوض - شارع الجامعة',
      nextStopEtaMins: 7,
    },
    {
      id: 'bus-103',
      busNumber: 'حافلة 103 (احتياطية)',
      plateNumber: 'ر ط 7890',
      driverId: null,
      driverName: 'الكابتن ناصر بن راشد الهنائي',
      driverPhone: '+968 9234 5678',
      driverAvatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200',
      capacity: 28,
      currentOccupancy: 0,
      currentLat: 23.6015,
      currentLng: 58.421,
      speedKmH: 0,
      status: 'idle',
      fuelLevel: 100,
      safetyScore: 100,
      assignedRouteId: 'route-103',
      nextStopName: 'المدرسة (مركز التجمع)',
      nextStopEtaMins: 0,
    },
  ];
  db.insert(legacyBuses).values(seedLegacyBuses).run();

  const seedLegacyStudents = [
    {
      id: 'std-1',
      name: 'مريم بنت أحمد البوسعيدية',
      grade: 'الصف الخامس الابتدائي',
      avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&q=80&w=200',
      schoolId: 'sch-1',
      schoolName: 'مدرسة المسار الدولية - القرم (مسقط)',
      parentId: 'u-1',
      parentName: 'أحمد بن سيف البوسعيدي',
      parentPhone: '+968 9111 2233',
      busId: 'bus-101',
      busNumber: 'حافلة 101',
      pickupLat: 23.595,
      pickupLng: 58.405,
      pickupAddress: 'حي القرم، شارع النهضة',
      pickupNameAr: 'نقطة توقف حي القرم (أ)',
      status: 'boarded',
      pickupTimePlanned: '06:40 ص',
      pickupTimeActual: '06:42 ص',
      seatNumber: '04A',
    },
    {
      id: 'std-2',
      name: 'الخليل بن أحمد البوسعيدي',
      grade: 'الصف الثاني الابتدائي',
      avatar: 'https://images.unsplash.com/photo-1485546246426-74dc88dec4d9?auto=format&fit=crop&q=80&w=200',
      schoolId: 'sch-1',
      schoolName: 'مدرسة المسار الدولية - القرم (مسقط)',
      parentId: 'u-1',
      parentName: 'أحمد بن سيف البوسعيدي',
      parentPhone: '+968 9111 2233',
      busId: 'bus-101',
      busNumber: 'حافلة 101',
      pickupLat: 23.595,
      pickupLng: 58.405,
      pickupAddress: 'حي القرم، شارع النهضة',
      pickupNameAr: 'نقطة توقف حي القرم (أ)',
      status: 'boarded',
      pickupTimePlanned: '06:40 ص',
      pickupTimeActual: '06:42 ص',
      seatNumber: '04B',
    },
    {
      id: 'std-3',
      name: 'سالم بن فهد الحوسني',
      grade: 'الصف السادس الابتدائي',
      avatar: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&q=80&w=200',
      schoolId: 'sch-1',
      schoolName: 'مدرسة المسار الدولية - القرم (مسقط)',
      parentId: null,
      parentName: 'فهد بن سلطان الحوسني',
      parentPhone: '+968 9444 5566',
      busId: 'bus-101',
      busNumber: 'حافلة 101',
      pickupLat: 23.589,
      pickupLng: 58.412,
      pickupAddress: 'حي العذيبة، قرب حديقة العذيبة',
      pickupNameAr: 'نقطة توقف حي العذيبة (ب)',
      status: 'waiting',
      pickupTimePlanned: '06:50 ص',
      pickupTimeActual: null,
      seatNumber: '07A',
    },
    {
      id: 'std-4',
      name: 'ريم بنت عبدالله الزدجالية',
      grade: 'الصف الرابع الابتدائي',
      avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=200',
      schoolId: 'sch-1',
      schoolName: 'مدرسة المسار الدولية - القرم (مسقط)',
      parentId: null,
      parentName: 'عبدالله بن علي الزدجالي',
      parentPhone: '+968 9777 8899',
      busId: 'bus-102',
      busNumber: 'حافلة 102',
      pickupLat: 23.615,
      pickupLng: 58.205,
      pickupAddress: 'حي الخوض، شارع البركات',
      pickupNameAr: 'نقطة توقف حي الخوض (ج)',
      status: 'waiting',
      pickupTimePlanned: '06:45 ص',
      pickupTimeActual: null,
      seatNumber: '02B',
    },
    {
      id: 'std-5',
      name: 'محمد بن ناصر البلوشي',
      grade: 'الصف الثالث الابتدائي',
      avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&q=80&w=200',
      schoolId: 'sch-1',
      schoolName: 'مدرسة المسار الدولية - القرم (مسقط)',
      parentId: null,
      parentName: 'ناصر بن خميس البلوشي',
      parentPhone: '+968 9222 3344',
      busId: 'bus-101',
      busNumber: 'حافلة 101',
      pickupLat: 23.602,
      pickupLng: 58.398,
      pickupAddress: 'حي الغبرة الشمالية',
      pickupNameAr: 'نقطة توقف الغبرة الشمالية',
      status: 'absent',
      pickupTimePlanned: '06:35 ص',
      pickupTimeActual: null,
      seatNumber: '01A',
    },
  ];
  db.insert(legacyStudents).values(seedLegacyStudents).run();

  // Phase 6A — one minimal, deterministic demo contact for the seeded demo
  // parent: their EMAIL, already verified (spec's explicit seed-only
  // allowance — "For demo/seed purposes, controlled seed data may contain
  // verified contacts if justified") since it is the exact same address
  // they already log in with. No SMS/PUSH seed data — there is no
  // legitimate phone/push-token value to seed without fabricating one
  // ("do not create fake production identities").
  const demoParent = seedUsers.find((u) => u.role === 'parent')!;
  const demoParentEmail = normalizeContactValue('EMAIL', demoParent.email);
  userContactRepository.create({
    userId: demoParent.id,
    channel: 'EMAIL',
    value: demoParentEmail.value,
    normalizedValue: demoParentEmail.normalizedValue,
    verifiedAt: new Date(),
    enabled: true,
  });

  const driverDefs = [
    { userId: seedUsers[2].id, name: 'الكابتن سعيد بن حمد البوسعيدي', phone: '+968 9123 4567' },
    { userId: seedUsers[3].id, name: 'الكابتن سالم بن خلفان المعمري', phone: '+968 9555 6677' },
    { userId: seedUsers[4].id, name: 'الكابتن ناصر بن راشد الهنائي', phone: '+968 9234 5678' },
  ].map((d) => ({ id: crypto.randomUUID(), ...d }));
  db.insert(drivers).values(driverDefs).run();

  const busDefs = [
    { id: crypto.randomUUID(), schoolId: school.id, busNumber: 'حافلة 101', plateNumber: 'ط ع 4589', driverId: driverDefs[0].id, capacity: 24, currentOccupancy: 18, status: 'en_route_school', currentLat: 23.598, currentLng: 58.41, speedKmh: 42, fuelLevel: 88, safetyScore: 98 },
    { id: crypto.randomUUID(), schoolId: school.id, busNumber: 'حافلة 102', plateNumber: 'م ص 1234', driverId: driverDefs[1].id, capacity: 20, currentOccupancy: 15, status: 'en_route_pickup', currentLat: 23.612, currentLng: 58.21, speedKmh: 38, fuelLevel: 75, safetyScore: 95 },
    { id: crypto.randomUUID(), schoolId: school.id, busNumber: 'حافلة 103 (احتياطية)', plateNumber: 'ر ط 7890', driverId: driverDefs[2].id, capacity: 28, currentOccupancy: 0, status: 'idle', currentLat: 23.6015, currentLng: 58.421, speedKmh: 0, fuelLevel: 96, safetyScore: 99 },
  ];
  db.insert(buses).values(busDefs).run();

  const routeDefs = [
    { id: crypto.randomUUID(), schoolId: school.id, name: 'مسار القرم', totalDistanceKm: 8.4, estimatedDurationMins: 22, status: 'active' },
    { id: crypto.randomUUID(), schoolId: school.id, name: 'مسار الخوض', totalDistanceKm: 11.2, estimatedDurationMins: 28, status: 'active' },
    { id: crypto.randomUUID(), schoolId: school.id, name: 'مسار العذيبة', totalDistanceKm: 6.7, estimatedDurationMins: 18, status: 'scheduled' },
  ];
  db.insert(routes).values(routeDefs).run();

  const stopDefs = [
    { id: crypto.randomUUID(), routeId: routeDefs[0].id, name: 'القرم أ - المجمع السكني', lat: 23.599, lng: 58.409, orderSequence: 1 },
    { id: crypto.randomUUID(), routeId: routeDefs[0].id, name: 'القرم ب - شارع الجوهرة', lat: 23.603, lng: 58.415, orderSequence: 2 },
    { id: crypto.randomUUID(), routeId: routeDefs[1].id, name: 'الخوض - شارع الجامعة', lat: 23.612, lng: 58.21, orderSequence: 1 },
    { id: crypto.randomUUID(), routeId: routeDefs[1].id, name: 'الخوض - المجمع التجاري', lat: 23.617, lng: 58.198, orderSequence: 2 },
    { id: crypto.randomUUID(), routeId: routeDefs[2].id, name: 'العذيبة - شارع النخيل', lat: 23.609, lng: 58.187, orderSequence: 1 },
  ];
  db.insert(routeStops).values(stopDefs).run();

  const studentDefs = Array.from({ length: 40 }, (_, i) => {
    const bus = busDefs[i % 2]; // pilot fleet: alternate the two active buses (bus 3 is a spare, no assigned students)
    const stop = stopDefs.filter((s) => (i % 2 === 0 ? s.routeId === routeDefs[0].id : s.routeId === routeDefs[1].id))[i % 2];
    return {
      id: crypto.randomUUID(),
      schoolId: school.id,
      name: studentName(i),
      grade: GRADES[i % GRADES.length],
      busId: bus.id,
      pickupLat: stop.lat + (i % 5) * 0.0008,
      pickupLng: stop.lng + (i % 5) * 0.0008,
      pickupAddress: stop.name,
      seatNumber: String((i % bus.capacity) + 1),
      parentName: parentName(i),
      parentPhone: `+968 9${String(100000 + i * 37).slice(0, 6)}`,
    };
  });

  // Phase 13 — the real parent<->student identity bridge (spec §4/§7/§8).
  // std-1/std-2 (seedLegacyStudents above) are the only two legacy
  // students with a real, tested ownership FK (parentId: 'u-1', the
  // legacy row for parent@masara.om). These two governed rows are their
  // deterministic governed-side counterparts, linked via the new
  // `legacyStudentId` column (database/schema.ts) — NOT by name or phone.
  // Placed on the real active bus/route (busDefs[0]/stopDefs for route 0)
  // so ensureJourneysForTrip (JourneyService.ts) auto-creates a real
  // scheduled journey for tripDefs[0] with no separate journey seeding
  // needed. Display name/grade/seat mirror the legacy record for human
  // readability only — the FK, not the name match, is what makes these
  // "the same student".
  const demoParentStudentDefs = [
    {
      id: crypto.randomUUID(),
      schoolId: school.id,
      name: 'مريم بنت أحمد البوسعيدية',
      grade: GRADES[4],
      busId: busDefs[0].id,
      pickupLat: stopDefs[0].lat,
      pickupLng: stopDefs[0].lng,
      pickupAddress: stopDefs[0].name,
      seatNumber: '04A',
      parentName: 'أحمد بن سيف البوسعيدي',
      parentPhone: '+968 9111 2233',
      legacyStudentId: 'std-1',
    },
    {
      id: crypto.randomUUID(),
      schoolId: school.id,
      name: 'الخليل بن أحمد البوسعيدي',
      grade: GRADES[1],
      busId: busDefs[0].id,
      pickupLat: stopDefs[0].lat,
      pickupLng: stopDefs[0].lng,
      pickupAddress: stopDefs[0].name,
      seatNumber: '04B',
      parentName: 'أحمد بن سيف البوسعيدي',
      parentPhone: '+968 9111 2233',
      legacyStudentId: 'std-2',
    },
  ];
  db.insert(students).values([...studentDefs, ...demoParentStudentDefs]).run();
  studentDefs.push(...demoParentStudentDefs);

  const now = new Date();
  const tripDefs = [
    {
      id: crypto.randomUUID(),
      routeId: routeDefs[0].id,
      busId: busDefs[0].id,
      driverId: driverDefs[0].id,
      status: 'active',
      startedAt: new Date(now.getTime() - 12 * 60_000),
      targetArrivalAt: new Date(now.getTime() + 3 * 60_000),
      currentEtaAt: new Date(now.getTime() + 4 * 60_000),
    },
    {
      id: crypto.randomUUID(),
      routeId: routeDefs[1].id,
      busId: busDefs[1].id,
      driverId: driverDefs[1].id,
      status: 'active',
      startedAt: new Date(now.getTime() - 8 * 60_000),
      targetArrivalAt: new Date(now.getTime() + 7 * 60_000),
      currentEtaAt: new Date(now.getTime() + 16 * 60_000), // running late — demo material for Phase 2
    },
    {
      id: crypto.randomUUID(),
      routeId: routeDefs[2].id,
      busId: busDefs[2].id,
      driverId: driverDefs[2].id,
      status: 'scheduled',
      targetArrivalAt: new Date(now.getTime() + 45 * 60_000),
    },
  ];
  db.insert(trips).values(tripDefs).run();

  return {
    school,
    users: seedUsers,
    drivers: driverDefs,
    buses: busDefs,
    routes: routeDefs,
    routeStops: stopDefs,
    students: studentDefs,
    trips: tripDefs,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = seed();
  console.log(
    `✅ Seeded: 1 school, ${result.users.length} users, ${result.drivers.length} drivers, ${result.buses.length} buses, ${result.routes.length} routes, ${result.routeStops.length} stops, ${result.students.length} students, ${result.trips.length} trips.`
  );
}
