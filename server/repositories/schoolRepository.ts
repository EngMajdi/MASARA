import { eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { schools } from '../../database/schema';

export const schoolRepository = {
  findAll: () => db.select().from(schools).all(),
  findById: (id: string) => db.select().from(schools).where(eq(schools.id, id)).get(),
};
