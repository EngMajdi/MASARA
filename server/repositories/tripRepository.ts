import { eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { trips } from '../../database/schema';

type TripUpdate = Partial<typeof trips.$inferInsert>;

export const tripRepository = {
  findAll: () => db.select().from(trips).all(),
  findById: (id: string) => db.select().from(trips).where(eq(trips.id, id)).get(),
  findByBusId: (busId: string) => db.select().from(trips).where(eq(trips.busId, busId)).all(),
  update: (id: string, changes: TripUpdate) =>
    db.update(trips).set({ ...changes, updatedAt: new Date() }).where(eq(trips.id, id)).run(),
};
