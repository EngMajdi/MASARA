import { desc, eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { predictions } from '../../database/schema';

type NewPrediction = typeof predictions.$inferInsert;

export const predictionRepository = {
  create: (prediction: NewPrediction) => {
    const row = { id: crypto.randomUUID(), ...prediction };
    db.insert(predictions).values(row).run();
    return row;
  },
  findLatestByTripId: (tripId: string) =>
    db.select().from(predictions).where(eq(predictions.tripId, tripId)).orderBy(desc(predictions.createdAt)).get(),
  findById: (id: string) => db.select().from(predictions).where(eq(predictions.id, id)).get(),
  /** Scoped cleanup when the owning trip is being removed — never a blanket wipe. */
  deleteByTripId: (tripId: string) => db.delete(predictions).where(eq(predictions.tripId, tripId)).run(),
};
