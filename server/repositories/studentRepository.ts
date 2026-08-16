import { eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { students } from '../../database/schema';

export const studentRepository = {
  findAll: () => db.select().from(students).all(),
  findById: (id: string) => db.select().from(students).where(eq(students.id, id)).get(),
  findByBusId: (busId: string) => db.select().from(students).where(eq(students.busId, busId)).all(),
};
