import { and, eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { aiRecommendations } from '../../database/schema';
import type { RecommendationStatus } from '../domain/StateMachine';

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
  findPendingByTripId: (tripId: string) =>
    db
      .select()
      .from(aiRecommendations)
      .where(and(eq(aiRecommendations.tripId, tripId), eq(aiRecommendations.status, 'pending')))
      .all(),
  update: (id: string, changes: RecommendationUpdate) =>
    db.update(aiRecommendations).set({ ...changes, updatedAt: new Date() }).where(eq(aiRecommendations.id, id)).run(),

  /**
   * Atomic conditional transition: only succeeds if the row is still in
   * `fromStatus` at the moment the UPDATE executes. This is the real
   * concurrency guard against double-approval (spec Phase 2A §18) — a single
   * SQL statement, not a check-then-write race. Returns false if another
   * request already moved the row out of `fromStatus`.
   */
  claimTransition: (
    id: string,
    fromStatus: RecommendationStatus,
    toStatus: RecommendationStatus,
    extraChanges: RecommendationUpdate = {}
  ): boolean => {
    const result = db
      .update(aiRecommendations)
      .set({ ...extraChanges, status: toStatus, updatedAt: new Date() })
      .where(and(eq(aiRecommendations.id, id), eq(aiRecommendations.status, fromStatus)))
      .run();
    return result.changes === 1;
  },
};
