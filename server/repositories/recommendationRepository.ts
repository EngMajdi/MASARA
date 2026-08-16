import { eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { aiRecommendations } from '../../database/schema';

type NewRecommendation = typeof aiRecommendations.$inferInsert;
type RecommendationUpdate = Partial<typeof aiRecommendations.$inferInsert>;

export const recommendationRepository = {
  create: (recommendation: NewRecommendation) => {
    const row = { id: crypto.randomUUID(), ...recommendation };
    db.insert(aiRecommendations).values(row).run();
    return row;
  },
  findAll: () => db.select().from(aiRecommendations).all(),
  findById: (id: string) => db.select().from(aiRecommendations).where(eq(aiRecommendations.id, id)).get(),
  findPending: () => db.select().from(aiRecommendations).where(eq(aiRecommendations.status, 'pending')).all(),
  update: (id: string, changes: RecommendationUpdate) =>
    db.update(aiRecommendations).set({ ...changes, updatedAt: new Date() }).where(eq(aiRecommendations.id, id)).run(),
};
