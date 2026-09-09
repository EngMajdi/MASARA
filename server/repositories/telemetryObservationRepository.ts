import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { db } from '../../database/client';
import { telemetryObservations } from '../../database/schema';

type NewTelemetryObservation = typeof telemetryObservations.$inferInsert;

export interface TelemetryObservationFilter {
  busId?: string;
  tripId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export const telemetryObservationRepository = {
  /**
   * Append-only (spec §28/§29) — no update/delete method exists on this
   * repository at all. May throw a better-sqlite3 SQLITE_CONSTRAINT error
   * on a (deviceId, sourceEventId) collision — the database-level
   * idempotency guard (spec §26); the caller (TelemetryIngestionService)
   * is responsible for catching it and deciding duplicate-vs-conflict,
   * exactly the same division of responsibility as
   * JourneyService.createJourney's defense-in-depth catch.
   */
  create: (entry: NewTelemetryObservation) => {
    const row = { id: crypto.randomUUID(), ...entry };
    db.insert(telemetryObservations).values(row).run();
    return row;
  },
  findByDeviceAndSourceEventId: (deviceId: string, sourceEventId: string) =>
    db
      .select()
      .from(telemetryObservations)
      .where(and(eq(telemetryObservations.deviceId, deviceId), eq(telemetryObservations.sourceEventId, sourceEventId)))
      .get(),
  /** Bounded, filtered history read (spec §84/§85) — most recent observation first. */
  findFiltered: (filter: TelemetryObservationFilter) => {
    const conditions = [];
    if (filter.busId) conditions.push(eq(telemetryObservations.busId, filter.busId));
    if (filter.tripId) conditions.push(eq(telemetryObservations.tripId, filter.tripId));
    if (filter.from) conditions.push(gte(telemetryObservations.occurredAt, filter.from));
    if (filter.to) conditions.push(lte(telemetryObservations.occurredAt, filter.to));

    const limit = Math.min(MAX_LIMIT, Math.max(1, filter.limit ?? DEFAULT_LIMIT));

    return db
      .select()
      .from(telemetryObservations)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(telemetryObservations.occurredAt))
      .limit(limit)
      .all();
  },

  /** Scoped cleanup when a governed trip or bus is being removed — never a blanket wipe of this append-only table. */
  deleteByTripId: (tripId: string) => db.delete(telemetryObservations).where(eq(telemetryObservations.tripId, tripId)).run(),
  deleteByBusId: (busId: string) => db.delete(telemetryObservations).where(eq(telemetryObservations.busId, busId)).run(),
};
