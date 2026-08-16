import { eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { buses } from '../../database/schema';

type BusUpdate = Partial<typeof buses.$inferInsert>;

export const busRepository = {
  findAll: () => db.select().from(buses).all(),
  findById: (id: string) => db.select().from(buses).where(eq(buses.id, id)).get(),
  update: (id: string, changes: BusUpdate) =>
    db.update(buses).set({ ...changes, updatedAt: new Date() }).where(eq(buses.id, id)).run(),
};
