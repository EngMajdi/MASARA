import { eq } from 'drizzle-orm';
import { db, type DbOrTx } from '../../database/client';
import { students } from '../../database/schema';

type NewGovernedStudent = typeof students.$inferInsert;

export const studentRepository = {
  findAll: () => db.select().from(students).all(),
  findById: (id: string) => db.select().from(students).where(eq(students.id, id)).get(),
  findByBusId: (busId: string) => db.select().from(students).where(eq(students.busId, busId)).all(),
  /** Phase 13 — the real, stable identity bridge (see database/schema.ts's students.legacyStudentId comment and ParentAccessService.ts). A genuine foreign key lookup, never a name/phone guess. */
  findByLegacyStudentId: (legacyStudentId: string) => db.select().from(students).where(eq(students.legacyStudentId, legacyStudentId)).get(),
  /**
   * Phase 14 — no live creation path existed before this (100% seed-only,
   * confirmed by a full repo audit). `legacyStudentId`, when provided, is
   * the caller's responsibility to have already verified against a real
   * legacy_students row — this method performs the write only, the same
   * division of responsibility legacyStudentRepository.create already
   * applies to its own real ownership FK.
   */
  create: (input: Omit<NewGovernedStudent, 'id'>, executor: DbOrTx = db) => {
    const row: NewGovernedStudent = { id: crypto.randomUUID(), ...input };
    executor.insert(students).values(row).run();
    return row;
  },
};
