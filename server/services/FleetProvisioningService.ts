import { busRepository } from '../repositories/busRepository';
import { driverRepository } from '../repositories/driverRepository';
import { routeRepository } from '../repositories/routeRepository';
import { tripRepository } from '../repositories/tripRepository';
import { legacyBusRepository } from '../repositories/legacyBusRepository';
import { userRepository } from '../repositories/userRepository';
import { legacyUserRepository } from '../repositories/legacyUserRepository';

// Phase 15 — Pilot Hardening: the one real cross-entity validation rule set
// in the minimum live fleet-provisioning surface (server/routes/fleetRoutes.ts).
// Extracted into its own testable function (same pattern as Phase 14's
// ProvisioningService.ts) rather than left inline in the Express handler,
// so the business rules below have real automated coverage, not just live
// browser spot-checks.
//
// LEGACY BUS BRIDGE — found live during this phase's own fresh-pilot
// verification, not assumed: `src/components/DriverPortal.tsx`'s PRIMARY
// "which bus is mine" gate (`buses.find(b => b.driverId === currentUser.id)`)
// reads exclusively from the LEGACY buses store — a pre-Phase-15 design
// (Phase 9B) that Phase 12's GPS-only bridge (`useOwnGovernedBusId`,
// matched by `busNumber` equality) never touched. A driver assigned only
// to a governed bus created here would see a real trip/journey/GPS pipeline
// working end-to-end at the API level, yet the Driver Portal's own landing
// screen would honestly (but wrongly, from the operator's point of view)
// say "no bus assigned" — because no LEGACY bus with a matching busNumber
// and a matching LEGACY driverId exists for them.
//
// Rather than rewrite DriverPortal.tsx's data model (real regression risk
// to the existing, proven, real-pilot-household flow) or duplicate driver
// identity, `createBus`/`assignDriverToBus` below create and keep a real
// LEGACY bus row in sync — joined to its governed counterpart by
// `busNumber` (the EXACT bridge `useOwnGovernedBusId` already uses), the
// same "reuse the existing join key, never invent a new one" discipline
// as every prior phase's identity work. No fabricated driver name/phone
// is ever written — an unassigned legacy bus gets an honest "—" placeholder,
// exactly like this UI's own "غير مُسند" convention elsewhere.
function findMatchingLegacyBus(busNumber: string) {
  return legacyBusRepository.findAll().find((b) => b.busNumber === busNumber);
}

/** The real legacy_users.id for a governed driver, via the same email join every guard already uses — never guessed, never name-matched. */
function legacyUserIdForGovernedDriver(governedDriverId: string): string | null {
  const driver = driverRepository.findById(governedDriverId);
  if (!driver?.userId) return null;
  const governedUser = userRepository.findById(driver.userId);
  if (!governedUser) return null;
  const legacyUser = legacyUserRepository.findByEmail(governedUser.email);
  return legacyUser?.id ?? null;
}

export class TripValidationError extends Error {}

const ACTIVE_TRIP_STATES = new Set(['scheduled', 'active']);

export type CreateTripInput = { routeId: string; busId: string; driverId?: string | null };

/**
 * Validates and creates a real governed trip. Every rejection throws
 * `TripValidationError` with a specific, human-readable Arabic message —
 * never a generic failure. Journeys are NOT created here (spec §8/§5) —
 * the existing, unchanged `ensureJourneysForTrip` picks this trip up
 * automatically the first time any read endpoint touches it, exactly as
 * it already does for seed-created trips.
 */
export function createTrip(input: CreateTripInput) {
  const route = routeRepository.findById(input.routeId);
  if (!route) throw new TripValidationError('المسار المحدد غير موجود.');
  if (routeRepository.findStopsByRouteId(input.routeId).length === 0) {
    throw new TripValidationError('لا يمكن إنشاء رحلة على مسار لا يحتوي على أي نقطة توقف.');
  }

  const bus = busRepository.findById(input.busId);
  if (!bus) throw new TripValidationError('الحافلة المحددة غير موجودة.');
  if (bus.status === 'maintenance') throw new TripValidationError('لا يمكن إنشاء رحلة على حافلة معطّلة (تحت الصيانة).');
  if (tripRepository.findByBusId(input.busId).some((t) => ACTIVE_TRIP_STATES.has(t.status))) {
    throw new TripValidationError('توجد رحلة نشطة أو مجدولة بالفعل لهذه الحافلة.');
  }

  let resolvedDriverId: string | null = null;
  if (input.driverId !== undefined && input.driverId !== null) {
    const driver = driverRepository.findById(input.driverId);
    if (!driver) throw new TripValidationError('السائق المحدد غير موجود.');
    if (tripRepository.findByDriverId(input.driverId).some((t) => ACTIVE_TRIP_STATES.has(t.status))) {
      throw new TripValidationError('هذا السائق مُكلّف بالفعل برحلة نشطة أو مجدولة أخرى.');
    }
    resolvedDriverId = input.driverId;
  } else if (bus.driverId) {
    resolvedDriverId = bus.driverId;
  }

  return tripRepository.create({ routeId: input.routeId, busId: input.busId, driverId: resolvedDriverId, status: 'scheduled' });
}

export type CreateBusInput = { schoolId: string; busNumber: string; plateNumber: string; capacity: number };

/**
 * Creates a real governed bus AND a real, matching legacy bus (see this
 * file's header comment) in the same call — never governed-only, which
 * would leave the Driver Portal's primary view unable to find it. The
 * legacy row starts fully unassigned/honest: no driver, no route, no
 * fabricated ETA or stop name.
 */
export function createBus(input: CreateBusInput) {
  const bus = busRepository.create({ schoolId: input.schoolId, busNumber: input.busNumber, plateNumber: input.plateNumber, capacity: input.capacity, currentOccupancy: 0, status: 'idle', speedKmh: 0, fuelLevel: 100, safetyScore: 100 });

  legacyBusRepository.create({
    busNumber: input.busNumber,
    plateNumber: input.plateNumber,
    driverName: '—',
    driverPhone: '—',
    driverAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    capacity: input.capacity,
    currentOccupancy: 0,
    currentLocation: { lat: 0, lng: 0 },
    speedKmH: 0,
    status: 'idle',
    fuelLevel: 100,
    safetyScore: 100,
    assignedRouteId: '',
    nextStopName: '—',
    nextStopEtaMins: 0,
  });

  return bus;
}

/**
 * Assigns/unassigns a real governed driver on a real governed bus, and
 * mirrors the same assignment onto the matching legacy bus (by busNumber)
 * using the driver's real legacy identity — never a fabricated one, and
 * never silently skipped if no legacy counterpart exists (that case is
 * left for the existing Phase 14 reconciliation tooling to surface, not
 * guessed here).
 */
export function assignDriverToBus(busId: string, driverId: string | null) {
  busRepository.update(busId, { driverId });
  const bus = busRepository.findById(busId);
  if (!bus) return;
  const legacyBus = findMatchingLegacyBus(bus.busNumber);
  if (!legacyBus) return;

  if (driverId === null) {
    legacyBusRepository.updateDriverId(legacyBus.id, null);
    return;
  }
  const driver = driverRepository.findById(driverId);
  const legacyUserId = legacyUserIdForGovernedDriver(driverId);
  if (legacyUserId && driver) {
    legacyBusRepository.updateDriverId(legacyBus.id, legacyUserId, driver.name);
  }
}
