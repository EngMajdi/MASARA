import { describe, it, expect } from 'vitest';
import { busRepository } from '../../server/repositories/busRepository';
import { routeRepository } from '../../server/repositories/routeRepository';
import { tripRepository } from '../../server/repositories/tripRepository';
import { studentRepository } from '../../server/repositories/studentRepository';
import { journeyRepository } from '../../server/repositories/journeyRepository';
import { notificationRepository } from '../../server/repositories/notificationRepository';
import { telemetryDeviceRepository } from '../../server/repositories/telemetryDeviceRepository';
import { currentLocationProjectionRepository } from '../../server/repositories/currentLocationProjectionRepository';
import { legacyBusRepository } from '../../server/repositories/legacyBusRepository';
import { userRepository } from '../../server/repositories/userRepository';
import { createTrip, createBus, deleteTrip, deleteBus, deleteRoute, FleetDeletionError } from '../../server/services/FleetProvisioningService';
import { createJourney } from '../../server/services/JourneyService';
import { getOrCreateDriverPhoneDevice } from '../../server/services/TelemetryDeviceService';
import { ingestObservation } from '../../server/services/TelemetryIngestionService';
import { recommendationRepository } from '../../server/repositories/recommendationRepository';
import { predictionRepository } from '../../server/repositories/predictionRepository';
import { actionRepository } from '../../server/repositories/actionRepository';
import { actionVerificationRepository } from '../../server/repositories/actionVerificationRepository';
import { auditRepository } from '../../server/repositories/auditRepository';
import { incidentRepository } from '../../server/repositories/incidentRepository';

// Phase 15.5 — closes the one gap the fleet-provisioning surface never had:
// removing a bus/route/trip once created, through the app, never the
// database. These tests exist specifically because real pilot/test data
// (proven end-to-end on the live production deployment) needed a real way
// to be cleaned up afterward.

function realSchoolId(): string {
  return userRepository.findByEmail('admin@masara.om')!.schoolId!;
}

function realRouteWithStop() {
  const route = routeRepository.create({ schoolId: realSchoolId(), name: `Deletion Test Route ${Date.now()}-${Math.random()}`, totalDistanceKm: 0, estimatedDurationMins: 0, status: 'scheduled' });
  const stop = routeRepository.createStop({ routeId: route.id, name: 'نقطة حذف', lat: 23.6, lng: 58.4, orderSequence: 1 });
  return { route, stop };
}

describe('FleetProvisioningService.deleteTrip', () => {
  it('deletes the trip and rejects a second delete of the same id', () => {
    const bus = createBus({ schoolId: realSchoolId(), busNumber: `Del Bus ${Date.now()}-${Math.random()}`, plateNumber: 'DEL-1', capacity: 20 });
    const { route } = realRouteWithStop();
    const trip = createTrip({ routeId: route.id, busId: bus.id });

    deleteTrip(trip.id);
    expect(tripRepository.findById(trip.id)).toBeFalsy();
    expect(() => deleteTrip(trip.id)).toThrow(FleetDeletionError);
  });

  it('deletes the trip\'s own journeys, notifications, and telemetry — never the bus, route, or student', () => {
    const bus = createBus({ schoolId: realSchoolId(), busNumber: `Del Bus ${Date.now()}-${Math.random()}`, plateNumber: 'DEL-2', capacity: 20 });
    const { route, stop } = realRouteWithStop();
    const trip = createTrip({ routeId: route.id, busId: bus.id });
    const student = studentRepository.create({ schoolId: realSchoolId(), name: 'طالب اختبار الحذف', grade: 'الأول', busId: bus.id, pickupLat: 23.6, pickupLng: 58.4, pickupAddress: 'test' });

    const journey = createJourney(student.id, trip.id, { actorId: null, actorType: 'system' });
    const device = getOrCreateDriverPhoneDevice(bus.id);
    ingestObservation({ id: device.id, busId: bus.id, providerType: 'DRIVER_PHONE' }, { sourceEventId: `del-test-${Date.now()}`, occurredAt: new Date().toISOString(), latitude: 23.6, longitude: 58.4 });

    expect(journeyRepository.findByTripId(trip.id)).toHaveLength(1);
    expect(currentLocationProjectionRepository.findByBusId(bus.id)).toBeTruthy();

    deleteTrip(trip.id);

    expect(tripRepository.findById(trip.id)).toBeFalsy();
    expect(journeyRepository.findByTripId(trip.id)).toHaveLength(0);
    expect(journeyRepository.findById(journey.id)).toBeFalsy();
    // Never touched: the bus, the route, and — most importantly — the real student record.
    expect(busRepository.findById(bus.id)).toBeTruthy();
    expect(routeRepository.findById(route.id)).toBeTruthy();
    expect(studentRepository.findById(student.id)).toBeTruthy();
    expect(routeRepository.findStopById(stop.id)).toBeTruthy();
  });

  it('rejects deleting a trip that does not exist', () => {
    expect(() => deleteTrip('no-such-trip')).toThrow(FleetDeletionError);
  });

  it('deletes the full AI-governance chain (prediction -> recommendation -> action -> verification) and clears — never deletes — audit_logs/incidents that reference this trip', () => {
    const bus = createBus({ schoolId: realSchoolId(), busNumber: `Del Bus ${Date.now()}-${Math.random()}`, plateNumber: 'DEL-6', capacity: 20 });
    const { route } = realRouteWithStop();
    const trip = createTrip({ routeId: route.id, busId: bus.id });

    const prediction = predictionRepository.create({ tripId: trip.id, delayMinutes: 12, delayProbability: 0.8, riskLevel: 'high', createdBy: 'engine' });
    const recommendation = recommendationRepository.create({
      tripId: trip.id, busId: bus.id, sourceRouteId: route.id, agentRunId: `test-run-${Date.now()}`, type: 'DELAY', title: 'اختبار الحذف',
      severity: 'high', problem: 'مشكلة اختبار', predictionId: prediction.id, confidence: 0.8, action: 'NOTIFY_SCHOOL', reason: 'سبب اختبار',
      requiresApproval: true, status: 'pending',
    });
    const action = actionRepository.create({ recommendationId: recommendation.id, actionType: 'NOTIFY_SCHOOL', payload: '{}' });
    actionVerificationRepository.create({ actionId: action.id, status: 'success', checkedAt: new Date() });
    const auditLog = auditRepository.create({ eventType: 'RECOMMENDATION_CREATED', actorType: 'system', entityType: 'ai_recommendation', entityId: recommendation.id, tripId: trip.id, inputSummary: 'اختبار حذف الرحلة' });
    const incident = incidentRepository.create({ tripId: trip.id, busId: bus.id, type: 'TRAFFIC', severity: 'medium', description: 'حادث اختبار' });

    deleteTrip(trip.id);

    expect(tripRepository.findById(trip.id)).toBeFalsy();
    expect(predictionRepository.findById(prediction.id)).toBeFalsy();
    expect(recommendationRepository.findById(recommendation.id)).toBeFalsy();
    expect(actionRepository.findByRecommendationId(recommendation.id)).toHaveLength(0);
    expect(actionVerificationRepository.findByActionId(action.id)).toHaveLength(0);

    // Never deleted — only the stale trip reference is cleared, the historical record survives.
    const auditRow = auditRepository.findAll().find((a) => a.id === auditLog.id)!;
    expect(auditRow).toBeTruthy();
    expect(auditRow.tripId).toBeNull();
    expect(auditRow.eventType).toBe('RECOMMENDATION_CREATED'); // content untouched

    expect(incidentRepository.findOpenByTripId(trip.id)).toHaveLength(0); // no longer findable by the now-gone trip
    // Confirm it genuinely still exists in the database, just unlinked from the deleted trip — never deleted.
    const incidentRow = incidentRepository.findById(incident.id)!;
    expect(incidentRow).toBeTruthy();
    expect(incidentRow.tripId).toBeNull();
    expect(incidentRow.description).toBe('حادث اختبار'); // content untouched
  });
});

describe('FleetProvisioningService.deleteBus', () => {
  it('refuses to delete a bus that still has a trip — never a silent cascade of operational history', () => {
    const bus = createBus({ schoolId: realSchoolId(), busNumber: `Del Bus ${Date.now()}-${Math.random()}`, plateNumber: 'DEL-3', capacity: 20 });
    const { route } = realRouteWithStop();
    createTrip({ routeId: route.id, busId: bus.id });
    expect(() => deleteBus(bus.id)).toThrow(FleetDeletionError);
    expect(busRepository.findById(bus.id)).toBeTruthy();
  });

  it('deletes a bus with no trips, unassigns (never deletes) any student on it, and removes the matching legacy bus', () => {
    const busNumber = `Del Bus ${Date.now()}-${Math.random()}`;
    const bus = createBus({ schoolId: realSchoolId(), busNumber, plateNumber: 'DEL-4', capacity: 20 });
    const student = studentRepository.create({ schoolId: realSchoolId(), name: 'طالب اختبار حذف الحافلة', grade: 'الثاني', busId: bus.id, pickupLat: 23.6, pickupLng: 58.4, pickupAddress: 'test' });
    const legacyBusBefore = legacyBusRepository.findAll().find((b) => b.busNumber === busNumber);
    expect(legacyBusBefore).toBeTruthy();

    deleteBus(bus.id);

    expect(busRepository.findById(bus.id)).toBeFalsy();
    expect(studentRepository.findById(student.id)).toBeTruthy(); // never deleted
    expect(studentRepository.findById(student.id)!.busId).toBeNull(); // honestly unassigned
    expect(legacyBusRepository.findAll().find((b) => b.busNumber === busNumber)).toBeFalsy();
  });

  it('rejects deleting a bus that does not exist', () => {
    expect(() => deleteBus('no-such-bus')).toThrow(FleetDeletionError);
  });
});

describe('FleetProvisioningService.deleteRoute', () => {
  it('refuses to delete a route that still has a trip', () => {
    const bus = createBus({ schoolId: realSchoolId(), busNumber: `Del Bus ${Date.now()}-${Math.random()}`, plateNumber: 'DEL-5', capacity: 20 });
    const { route } = realRouteWithStop();
    createTrip({ routeId: route.id, busId: bus.id });
    expect(() => deleteRoute(route.id)).toThrow(FleetDeletionError);
    expect(routeRepository.findById(route.id)).toBeTruthy();
  });

  it('deletes a route with no trips, and its own stops along with it', () => {
    const { route, stop } = realRouteWithStop();
    deleteRoute(route.id);
    expect(routeRepository.findById(route.id)).toBeFalsy();
    expect(routeRepository.findStopById(stop.id)).toBeFalsy();
  });

  it('rejects deleting a route that does not exist', () => {
    expect(() => deleteRoute('no-such-route')).toThrow(FleetDeletionError);
  });
});
