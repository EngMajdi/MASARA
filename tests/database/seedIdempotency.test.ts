import { describe, it, expect } from 'vitest';
import { seed } from '../../database/seed/seed';
import { runForTrip } from '../../server/agents/MasaraOperationsAgent';
import { tripRepository } from '../../server/repositories/tripRepository';
import { studentRepository } from '../../server/repositories/studentRepository';
import { createJourney, boardStudent, startJourney, startBoarding } from '../../server/services/JourneyService';
import { registerDevice } from '../../server/services/TelemetryDeviceService';
import { ingestObservation } from '../../server/services/TelemetryIngestionService';
import { busRepository } from '../../server/repositories/busRepository';
import { routeRepository } from '../../server/repositories/routeRepository';
import { getCurrentLocation } from '../../server/services/CurrentLocationProjectionService';
import { etaAccuracyRepository } from '../../server/repositories/etaAccuracyRepository';
import { userRepository } from '../../server/repositories/userRepository';
import { resolveAuthorizedStudents } from '../../server/services/ParentAccessService';
import { processPendingNotificationsForParent, getUnreadCountForParent } from '../../server/services/NotificationService';
import { createContact } from '../../server/services/UserContactService';

describe('Seed script teardown order', () => {
  it('can reseed after governance tables have rows (predictions/recommendations/audit_logs) without FK errors', async () => {
    const trip = tripRepository.findAll().find((t) => t.status === 'active')!;
    // Populates predictions, and usually ai_recommendations + audit_logs, referencing this trip.
    await runForTrip(trip.id);
    expect(() => seed()).not.toThrow();
  });

  it('can reseed after journeys table has rows too (spec Phase 3A — this exact FK-order bug has recurred every time a new table was added)', () => {
    const trip = tripRepository.findAll()[0];
    const student = studentRepository.findByBusId(trip.busId)[0];
    let journey = createJourney(student.id, trip.id, { actorId: null, actorType: 'system' });
    journey = startJourney(journey.id, { actorId: null, actorType: 'system' });
    startBoarding(journey.id, { actorId: null, actorType: 'system' });
    boardStudent(journey.id, { actorId: null, actorType: 'system' }); // journeys row + boarding_events row + audit_logs rows
    expect(() => seed()).not.toThrow();
  });

  it('can reseed after telemetry_devices and telemetry_observations have rows too (spec Phase 4B §100/§101 — same recurring FK-order bug class, guarded again)', () => {
    const bus = busRepository.findAll()[0];
    const { device } = registerDevice(bus.id, 'TEST DEVICE — seed idempotency', 'DEVICE');
    ingestObservation(
      { id: device.id, busId: device.busId, providerType: 'DEVICE' },
      { sourceEventId: `evt-${crypto.randomUUID()}`, occurredAt: new Date().toISOString(), latitude: 23.6, longitude: 58.4 }
    ); // telemetry_devices row + telemetry_observations row
    expect(() => seed()).not.toThrow();
  });

  it('can reseed after current_location_projection has rows too (spec Phase 4C §23/§50 — same recurring FK-order bug class, guarded again)', () => {
    const bus = busRepository.findAll()[0];
    const { device } = registerDevice(bus.id, 'TEST DEVICE — seed idempotency 4C', 'DEVICE');
    ingestObservation(
      { id: device.id, busId: device.busId, providerType: 'DEVICE' },
      { sourceEventId: `evt-${crypto.randomUUID()}`, occurredAt: new Date().toISOString(), latitude: 23.6, longitude: 58.4 }
    );
    expect(getCurrentLocation(bus.id)).toBeTruthy(); // current_location_projection row exists
    expect(() => seed()).not.toThrow();
  });

  it('can reseed after eta_accuracy_observations has rows too (Phase 4E — same recurring FK-order bug class, guarded again)', () => {
    const trip = tripRepository.findAll()[0];
    const stops = routeRepository.findStopsByRouteId(trip.routeId);
    etaAccuracyRepository.insertSnapshotIfAbsent({
      tripId: trip.id,
      busId: trip.busId,
      stopId: stops[0].id,
      predictionTimestamp: new Date(),
      predictedArrivalAt: new Date(Date.now() + 5 * 60_000),
      confidence: 'MEDIUM',
      predictionSource: 'SIMULATION',
    });
    expect(() => seed()).not.toThrow();
  });

  it('can reseed after notifications has rows too (Phase 5B — same recurring FK-order bug class, guarded again)', () => {
    const parentUser = userRepository.findByEmail('parent@masara.om')!;
    // The demo parent's SECOND child (on bus 102/trip[1]) — the earlier
    // "journeys table" test above already created a journey for the first
    // child on trip[0]; a student can only ever be assigned to the one trip
    // matching their own busId (JourneyService.createJourney's own
    // validation), so this must be a genuinely different (student, trip)
    // pair, not just a different trip for the same student.
    const student = resolveAuthorizedStudents(parentUser)[1];
    const trip = tripRepository.findAll().find((t) => t.busId === student.busId)!;
    let journey = createJourney(student.id, trip.id, { actorId: null, actorType: 'system' });
    journey = startJourney(journey.id, { actorId: null, actorType: 'system' });
    startBoarding(journey.id, { actorId: null, actorType: 'system' });
    boardStudent(journey.id, { actorId: null, actorType: 'system' }); // STUDENT_BOARDED audit row -> eligible for notification
    processPendingNotificationsForParent(parentUser); // notifications row created through the real service, not a manual insert (spec §31)
    expect(getUnreadCountForParent(parentUser)).toBeGreaterThan(0);
    expect(() => seed()).not.toThrow();
  });

  it('can reseed after user_contacts has rows too (Phase 6A — same recurring FK-order bug class, guarded again)', () => {
    const admin = userRepository.findByEmail('admin@masara.om')!;
    createContact(admin, { channel: 'SMS', value: '+96895550000' }); // user_contacts row, created through the real service
    expect(() => seed()).not.toThrow();
  });
});
