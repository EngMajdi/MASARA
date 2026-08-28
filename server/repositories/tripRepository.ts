import { eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { trips } from '../../database/schema';

type TripUpdate = Partial<typeof trips.$inferInsert>;
type NewTrip = typeof trips.$inferInsert;

export const tripRepository = {
  findAll: () => db.select().from(trips).all(),
  findById: (id: string) => db.select().from(trips).where(eq(trips.id, id)).get(),
  findByBusId: (busId: string) => db.select().from(trips).where(eq(trips.busId, busId)).all(),
  findByDriverId: (driverId: string) => db.select().from(trips).where(eq(trips.driverId, driverId)).all(),
  update: (id: string, changes: TripUpdate) =>
    db.update(trips).set({ ...changes, updatedAt: new Date() }).where(eq(trips.id, id)).run(),
  /** Phase 15 — no live creation path existed before this (100% seed-only). Validation (route has stops, bus not in maintenance, no duplicate active trip) is the caller's responsibility (server.ts route) — this performs the write only. */
  create: (input: Omit<NewTrip, 'id'>) => {
    const row: NewTrip = { id: crypto.randomUUID(), ...input };
    db.insert(trips).values(row).run();
    return row;
  },
};
