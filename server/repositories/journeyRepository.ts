import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { journeys } from '../../database/schema';
import type { JourneyState } from '../domain/JourneyStateMachine';

type NewJourney = typeof journeys.$inferInsert;
type JourneyUpdate = Partial<typeof journeys.$inferInsert>;

export const journeyRepository = {
  create: (journey: NewJourney) => {
    const row = { id: crypto.randomUUID(), ...journey };
    db.insert(journeys).values(row).run();
    return row;
  },
  findById: (id: string) => db.select().from(journeys).where(eq(journeys.id, id)).get(),
  findByStudentAndTrip: (studentId: string, tripId: string) =>
    db.select().from(journeys).where(and(eq(journeys.studentId, studentId), eq(journeys.tripId, tripId))).get(),
  findByStudentId: (studentId: string) =>
    db.select().from(journeys).where(eq(journeys.studentId, studentId)).orderBy(desc(journeys.createdAt)).all(),
  findByTripId: (tripId: string) => db.select().from(journeys).where(eq(journeys.tripId, tripId)).all(),
  /** Scoped cleanup when a governed trip is being removed — never a blanket wipe. */
  deleteByTripId: (tripId: string) => db.delete(journeys).where(eq(journeys.tripId, tripId)).run(),
  update: (id: string, changes: JourneyUpdate) =>
    db.update(journeys).set({ ...changes, updatedAt: new Date() }).where(eq(journeys.id, id)).run(),

  /**
   * Atomic conditional transition (same pattern as recommendationRepository):
   * only succeeds if the row is still in `fromState` at UPDATE time. Guards
   * against two concurrent operations (e.g. two drivers both boarding the
   * same student) both succeeding — spec Phase 3A §32.
   */
  claimTransition: (id: string, fromState: JourneyState, toState: JourneyState, extraChanges: JourneyUpdate = {}): boolean => {
    const result = db
      .update(journeys)
      .set({ ...extraChanges, state: toState, updatedAt: new Date() })
      .where(and(eq(journeys.id, id), eq(journeys.state, fromState)))
      .run();
    return result.changes === 1;
  },
};
