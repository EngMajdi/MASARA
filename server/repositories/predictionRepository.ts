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
};
