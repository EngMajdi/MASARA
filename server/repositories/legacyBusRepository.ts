import { eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { legacyBuses } from '../../database/schema';
import type { Bus } from '../../src/types';

type LegacyBusRow = typeof legacyBuses.$inferSelect;

// Phase 7K — persistence for server.ts's legacy bus resource (previously
// `let buses = [...INITIAL_BUSES]`, a plain in-memory array never shared
// across processes). Pure data access + shape mapping only, mirroring
// legacyUserRepository.ts. `currentLocation: {lat,lng}` is flattened in
// the table (currentLat/currentLng) and reassembled here on every read,
// so every existing API caller keeps seeing the exact same nested shape
// (src/types.ts's `Bus` interface) it always has.

export type LegacyBusView = Bus & { driverId: string | null };

/** Fields the legacy create-bus form (DataManagementModal.tsx) actually sends. driverId is deliberately excluded — never accepted from a caller; see create() below. */
export type LegacyBusCreateInput = Omit<Bus, 'id' | 'driverId'>;

function toView(row: LegacyBusRow): LegacyBusView {
  return {
    id: row.id,
    busNumber: row.busNumber,
    plateNumber: row.plateNumber,
    driverId: row.driverId,
    driverName: row.driverName,
    driverPhone: row.driverPhone,
    driverAvatar: row.driverAvatar,
    capacity: row.capacity,
    currentOccupancy: row.currentOccupancy,
    currentLocation: { lat: row.currentLat, lng: row.currentLng },
    speedKmH: row.speedKmH,
    status: row.status as Bus['status'],
    fuelLevel: row.fuelLevel,
    safetyScore: row.safetyScore,
    assignedRouteId: row.assignedRouteId ?? '',
    nextStopName: row.nextStopName,
    nextStopEtaMins: row.nextStopEtaMins,
  };
}

export const legacyBusRepository = {
  findAll: (): LegacyBusView[] => db.select().from(legacyBuses).all().map(toView),

  findById: (id: string): LegacyBusView | undefined => {
    const row = db.select().from(legacyBuses).where(eq(legacyBuses.id, id)).get();
    return row ? toView(row) : undefined;
  },

  // Server-side only — never derived from a client body. See the schema
  // comment on legacyBuses.driverId for why: no trusted assignment
  // mechanism exists yet, so a newly created bus is deliberately
  // unassigned rather than trusting a client-supplied owner.
  create: (input: LegacyBusCreateInput): LegacyBusView => {
    const row = {
      id: `bus-${Date.now()}`,
      busNumber: input.busNumber,
      plateNumber: input.plateNumber,
      driverId: null,
      driverName: input.driverName,
      driverPhone: input.driverPhone,
      driverAvatar: input.driverAvatar,
      capacity: input.capacity,
      currentOccupancy: input.currentOccupancy,
      currentLat: input.currentLocation.lat,
      currentLng: input.currentLocation.lng,
      speedKmH: input.speedKmH,
      status: input.status,
      fuelLevel: input.fuelLevel,
      safetyScore: input.safetyScore,
      assignedRouteId: input.assignedRouteId || null,
      nextStopName: input.nextStopName,
      nextStopEtaMins: input.nextStopEtaMins,
    };
    db.insert(legacyBuses).values(row).run();
    return toView(db.select().from(legacyBuses).where(eq(legacyBuses.id, row.id)).get()!);
  },

  deleteById: (id: string): boolean => {
    const result = db.delete(legacyBuses).where(eq(legacyBuses.id, id)).run();
    return result.changes > 0;
  },

  /** Route-start mutation only — the one bus field server.ts's routes actually update in place. */
  updateStatus: (id: string, status: Bus['status']): LegacyBusView | undefined => {
    db.update(legacyBuses).set({ status, updatedAt: new Date() }).where(eq(legacyBuses.id, id)).run();
    return legacyBusRepository.findById(id);
  },

  /** Phase 8B — the ownership assignment Phase 7K deliberately left unbuilt ("no assignment mechanism exists"). Caller (server.ts route) is responsible for validating driverId resolves to an active legacy_users row with role='driver' before calling this — this method performs the write only. */
  updateDriverId: (id: string, driverId: string | null): LegacyBusView | undefined => {
    db.update(legacyBuses).set({ driverId, updatedAt: new Date() }).where(eq(legacyBuses.id, id)).run();
    return legacyBusRepository.findById(id);
  },

  /** Test-only — full reset between test files. */
  clear: () => db.delete(legacyBuses).run(),
};
