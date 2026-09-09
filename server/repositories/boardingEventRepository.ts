import { eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { boardingEvents } from '../../database/schema';

type NewBoardingEvent = typeof boardingEvents.$inferInsert;

export const boardingEventRepository = {
  create: (event: NewBoardingEvent) => {
    const row = { id: crypto.randomUUID(), ...event };
    db.insert(boardingEvents).values(row).run();
    return row;
  },
  findByTripId: (tripId: string) => db.select().from(boardingEvents).where(eq(boardingEvents.tripId, tripId)).all(),
  /** Scoped cleanup when a governed trip is being removed — never a blanket wipe. */
  deleteByTripId: (tripId: string) => db.delete(boardingEvents).where(eq(boardingEvents.tripId, tripId)).run(),
};
