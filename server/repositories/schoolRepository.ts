import { eq } from 'drizzle-orm';
import { db, type DbOrTx } from '../../database/client';
import { schools } from '../../database/schema';

type NewSchool = typeof schools.$inferInsert;

export const schoolRepository = {
  findAll: () => db.select().from(schools).all(),
  findById: (id: string) => db.select().from(schools).where(eq(schools.id, id)).get(),
  // Phase 15.5 — Cloud Pilot Readiness: the ONLY live path that can create
  // a school row without direct database intervention. Previously every
  // school row came exclusively from database/seed/seed.ts (a fully
  // destructive dev/test seed — see its own header comment). A real pilot
  // needs exactly one real school created once, non-destructively — see
  // database/seed/genesis.ts, the sole caller of this method.
  create: (input: Omit<NewSchool, 'id'>, executor: DbOrTx = db) => {
    const row: NewSchool = { id: crypto.randomUUID(), ...input };
    executor.insert(schools).values(row).run();
    return row;
  },
};
