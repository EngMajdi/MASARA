import { eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { drivers } from '../../database/schema';

export const driverRepository = {
  findAll: () => db.select().from(drivers).all(),
  findById: (id: string) => db.select().from(drivers).where(eq(drivers.id, id)).get(),
};
