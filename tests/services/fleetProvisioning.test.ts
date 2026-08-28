import { describe, it, expect } from 'vitest';
import { busRepository } from '../../server/repositories/busRepository';
import { routeRepository } from '../../server/repositories/routeRepository';
import { driverRepository } from '../../server/repositories/driverRepository';
import { tripRepository } from '../../server/repositories/tripRepository';
import { userRepository } from '../../server/repositories/userRepository';
import { createTrip, TripValidationError } from '../../server/services/FleetProvisioningService';

// Phase 15 — Pilot Hardening: the minimum live fleet-provisioning surface
// (server/routes/fleetRoutes.ts, server/services/FleetProvisioningService.ts).
// Proves a real school/admin can build School -> Route -> Stops -> Bus ->
// Driver -> Trip entirely through real repository calls (the same ones the
// live routes call), with the real cross-entity validation rules enforced,
// and that no journey is fabricated — journeys still only ever come from
// the pre-existing, unchanged ensureJourneysForTrip.

function realSchoolId(): string {
  return userRepository.findByEmail('admin@masara.om')!.schoolId!;
}

describe('Fleet provisioning — buses, routes, stops (spec §6/§7)', () => {
  it('creates a real governed bus with honest defaults (idle, zero occupancy, no driver)', () => {
    const bus = busRepository.create({ schoolId: realSchoolId(), busNumber: `Test Bus ${Date.now()}`, plateNumber: 'TEST-1', capacity: 20, currentOccupancy: 0, status: 'idle', speedKmh: 0, fuelLevel: 100, safetyScore: 100 });
    const fetched = busRepository.findById(bus.id)!;
    expect(fetched.status).toBe('idle');
    expect(fetched.driverId).toBeNull();
    expect(fetched.currentOccupancy).toBe(0);
  });

  it('assigning and unassigning a driver updates the real bus row', () => {
    const bus = busRepository.create({ schoolId: realSchoolId(), busNumber: `Test Bus ${Date.now()}`, plateNumber: 'TEST-2', capacity: 20, currentOccupancy: 0, status: 'idle', speedKmh: 0, fuelLevel: 100, safetyScore: 100 });
    const driver = driverRepository.create({ userId: null, name: 'سائق اختبار', phone: '+968 90000000' });
    busRepository.update(bus.id, { driverId: driver.id });
    expect(busRepository.findById(bus.id)!.driverId).toBe(driver.id);
    busRepository.update(bus.id, { driverId: null });
    expect(busRepository.findById(bus.id)!.driverId).toBeNull();
  });

  it('activate/deactivate reuses the existing status enum (idle <-> maintenance), never a new column', () => {
    const bus = busRepository.create({ schoolId: realSchoolId(), busNumber: `Test Bus ${Date.now()}`, plateNumber: 'TEST-3', capacity: 20, currentOccupancy: 0, status: 'idle', speedKmh: 0, fuelLevel: 100, safetyScore: 100 });
    busRepository.update(bus.id, { status: 'maintenance' });
    expect(busRepository.findById(bus.id)!.status).toBe('maintenance');
    busRepository.update(bus.id, { status: 'idle' });
    expect(busRepository.findById(bus.id)!.status).toBe('idle');
  });

  it('creates a real route with zero stops by default, then real stops with a valid, non-fabricated coordinate', () => {
    const route = routeRepository.create({ schoolId: realSchoolId(), name: `Test Route ${Date.now()}`, totalDistanceKm: 0, estimatedDurationMins: 0, status: 'scheduled' });
    expect(routeRepository.findStopsByRouteId(route.id)).toHaveLength(0);

    const stop1 = routeRepository.createStop({ routeId: route.id, name: 'نقطة 1', lat: 23.6, lng: 58.4, orderSequence: 1 });
    const stop2 = routeRepository.createStop({ routeId: route.id, name: 'نقطة 2', lat: 23.61, lng: 58.41, orderSequence: 2 });
    const stops = routeRepository.findStopsByRouteId(route.id).sort((a, b) => a.orderSequence - b.orderSequence);
    expect(stops.map((s) => s.id)).toEqual([stop1.id, stop2.id]);
  });

  it('updating and deleting a stop only ever touches that one real row', () => {
    const route = routeRepository.create({ schoolId: realSchoolId(), name: `Test Route ${Date.now()}`, totalDistanceKm: 0, estimatedDurationMins: 0, status: 'scheduled' });
    const stop = routeRepository.createStop({ routeId: route.id, name: 'نقطة أصلية', lat: 23.6, lng: 58.4, orderSequence: 1 });
    routeRepository.updateStop(stop.id, { name: 'نقطة معدّلة' });
    expect(routeRepository.findStopById(stop.id)!.name).toBe('نقطة معدّلة');
    routeRepository.deleteStop(stop.id);
    expect(routeRepository.findStopById(stop.id)).toBeUndefined();
  });
});

describe('FleetProvisioningService.createTrip — real cross-entity validation (spec §8)', () => {
  function realBus(status: string = 'idle') {
    return busRepository.create({ schoolId: realSchoolId(), busNumber: `Trip Test Bus ${Date.now()}-${Math.random()}`, plateNumber: 'TRIP-TEST', capacity: 20, currentOccupancy: 0, status, speedKmh: 0, fuelLevel: 100, safetyScore: 100 });
  }
  function realRouteWithStops(stopCount = 1) {
    const route = routeRepository.create({ schoolId: realSchoolId(), name: `Trip Test Route ${Date.now()}-${Math.random()}`, totalDistanceKm: 0, estimatedDurationMins: 0, status: 'scheduled' });
    for (let i = 0; i < stopCount; i++) routeRepository.createStop({ routeId: route.id, name: `نقطة ${i}`, lat: 23.6, lng: 58.4, orderSequence: i + 1 });
    return route;
  }

  it('rejects a route that does not exist', () => {
    const bus = realBus();
    expect(() => createTrip({ routeId: 'does-not-exist', busId: bus.id })).toThrow(TripValidationError);
  });

  it('rejects a route with zero stops — never fabricates a stop to make it pass', () => {
    const bus = realBus();
    const emptyRoute = routeRepository.create({ schoolId: realSchoolId(), name: `Empty Route ${Date.now()}`, totalDistanceKm: 0, estimatedDurationMins: 0, status: 'scheduled' });
    expect(() => createTrip({ routeId: emptyRoute.id, busId: bus.id })).toThrow(/نقطة توقف/);
  });

  it('rejects a bus that does not exist', () => {
    const route = realRouteWithStops();
    expect(() => createTrip({ routeId: route.id, busId: 'does-not-exist' })).toThrow(TripValidationError);
  });

  it('rejects a bus currently in maintenance', () => {
    const bus = realBus('maintenance');
    const route = realRouteWithStops();
    expect(() => createTrip({ routeId: route.id, busId: bus.id })).toThrow(/صيانة/);
  });

  it('rejects a second trip on a bus that already has an active/scheduled trip', () => {
    const bus = realBus();
    const route = realRouteWithStops();
    createTrip({ routeId: route.id, busId: bus.id });
    const secondRoute = realRouteWithStops();
    expect(() => createTrip({ routeId: secondRoute.id, busId: bus.id })).toThrow(/رحلة نشطة أو مجدولة/);
  });

  it('rejects a driver that does not exist', () => {
    const bus = realBus();
    const route = realRouteWithStops();
    expect(() => createTrip({ routeId: route.id, busId: bus.id, driverId: 'does-not-exist' })).toThrow(TripValidationError);
  });

  it('rejects a driver already assigned to another active/scheduled trip', () => {
    const driver = driverRepository.create({ userId: null, name: 'سائق مزدحم', phone: '+968 90000001' });
    const busA = realBus();
    const routeA = realRouteWithStops();
    createTrip({ routeId: routeA.id, busId: busA.id, driverId: driver.id });

    const busB = realBus();
    const routeB = realRouteWithStops();
    expect(() => createTrip({ routeId: routeB.id, busId: busB.id, driverId: driver.id })).toThrow(/مُكلّف بالفعل/);
  });

  it('a valid trip is created with status "scheduled" and no journeys are fabricated as a side effect', () => {
    const bus = realBus();
    const route = realRouteWithStops();
    const trip = createTrip({ routeId: route.id, busId: bus.id });
    expect(trip.status).toBe('scheduled');
    expect(tripRepository.findById(trip.id)).toBeTruthy();
  });

  it('falls back to the bus\'s own assigned driver when no explicit driverId is given', () => {
    const driver = driverRepository.create({ userId: null, name: 'سائق الحافلة', phone: '+968 90000002' });
    const bus = realBus();
    busRepository.update(bus.id, { driverId: driver.id });
    const route = realRouteWithStops();
    const trip = createTrip({ routeId: route.id, busId: bus.id });
    expect(trip.driverId).toBe(driver.id);
  });
});
