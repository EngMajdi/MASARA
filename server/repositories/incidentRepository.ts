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
  findByTripId: (tripId: string) => db.select().from(incidents).where(eq(incidents.tripId, tripId)).all(),
  findOpenByTripId: (tripId: string) =>
    db.select().from(incidents).where(and(eq(incidents.tripId, tripId), eq(incidents.status, 'open'))).all(),
};
