import { and, eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { incidents } from '../../database/schema';

type NewIncident = typeof incidents.$inferInsert;

export const incidentRepository = {
  create: (incident: NewIncident) => {
    const row = { id: crypto.randomUUID(), ...incident };
    db.insert(incidents).values(row).run();
    return row;
  },
  findById: (id: string) => db.select().from(incidents).where(eq(incidents.id, id)).get(),
  findByTripId: (tripId: string) => db.select().from(incidents).where(eq(incidents.tripId, tripId)).all(),
  findOpenByTripId: (tripId: string) =>
    db.select().from(incidents).where(and(eq(incidents.tripId, tripId), eq(incidents.status, 'open'))).all(),
  /**
   * When the owning trip is being removed: a real safety incident never
   * disappears just because the trip row was cleaned up — this clears the
   * now-stale trip reference (tripId -> null; incidents.tripId is
   * nullable precisely for this "no active trip" case, spec-wise the same
   * shape as bus-only telemetry) while the incident record itself, and
   * every other field on it, is left completely untouched.
   */
  clearTripId: (tripId: string) => db.update(incidents).set({ tripId: null, updatedAt: new Date() }).where(eq(incidents.tripId, tripId)).run(),
};
