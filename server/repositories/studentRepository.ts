import { eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { students } from '../../database/schema';

export const studentRepository = {
  findAll: () => db.select().from(students).all(),
  findById: (id: string) => db.select().from(students).where(eq(students.id, id)).get(),
  findByBusId: (busId: string) => db.select().from(students).where(eq(students.busId, busId)).all(),
  /** Phase 5A — the entire DEMO-ONLY parent identity mechanism (see parentAccessContract.ts). A plain value-equality read on an existing free-text column, never a foreign key. */
  findByParentPhone: (phone: string) => db.select().from(students).where(eq(students.parentPhone, phone)).all(),
};
