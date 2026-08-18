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
} from '../schema';
import { DEMO_PARENT_PHONE_BY_EMAIL } from '../../server/domain/parentAccessContract';
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

export function seed() {
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

  // Phase 5A — the first two students on bus 101 are the demo parent's
  // children (see server/domain/parentAccessContract.ts's header comment
  // for the full DEMO-ONLY rationale). Every other student keeps the
  // original generic auto-generated parentName/parentPhone, unchanged.
  const demoParentPhone = DEMO_PARENT_PHONE_BY_EMAIL['parent@masara.om'];
  const studentDefs = Array.from({ length: 40 }, (_, i) => {
    const bus = busDefs[i % 2]; // pilot fleet: alternate the two active buses (bus 3 is a spare, no assigned students)
    const stop = stopDefs.filter((s) => (i % 2 === 0 ? s.routeId === routeDefs[0].id : s.routeId === routeDefs[1].id))[i % 2];
    const isDemoParentChild = i === 0 || i === 1;
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
      parentName: isDemoParentChild ? 'أحمد بن سيف البوسعيدي' : parentName(i),
      parentPhone: isDemoParentChild ? demoParentPhone : `+968 9${String(100000 + i * 37).slice(0, 6)}`,
    };
  });
  db.insert(students).values(studentDefs).run();

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
