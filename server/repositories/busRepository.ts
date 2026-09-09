import { eq } from 'drizzle-orm';
import { db, type DbOrTx } from '../../database/client';
import { buses } from '../../database/schema';

type BusUpdate = Partial<typeof buses.$inferInsert>;
type NewBus = typeof buses.$inferInsert;

export const busRepository = {
  findAll: () => db.select().from(buses).all(),
  findById: (id: string) => db.select().from(buses).where(eq(buses.id, id)).get(),
  update: (id: string, changes: BusUpdate) =>
    db.update(buses).set({ ...changes, updatedAt: new Date() }).where(eq(buses.id, id)).run(),
  /** Phase 15 — no live creation path existed before this (100% seed-only). */
  create: (input: Omit<NewBus, 'id'>, executor: DbOrTx = db) => {
    const row: NewBus = { id: crypto.randomUUID(), ...input };
    executor.insert(buses).values(row).run();
    return row;
  },
  /** Phase 15.5 — deletion only ever happens through FleetProvisioningService.deleteBus, which unassigns any students first and clears this bus's own telemetry rows — never called against a bus a trip still references (the FK would reject it anyway). */
  deleteById: (id: string) => db.delete(buses).where(eq(buses.id, id)).run(),
};
