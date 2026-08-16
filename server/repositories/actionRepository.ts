import { eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { actions } from '../../database/schema';

type NewAction = typeof actions.$inferInsert;

export const actionRepository = {
  create: (action: NewAction) => {
    const row = { id: crypto.randomUUID(), ...action };
    db.insert(actions).values(row).run();
    return row;
  },
  findByRecommendationId: (recommendationId: string) =>
    db.select().from(actions).where(eq(actions.recommendationId, recommendationId)).all(),
};
