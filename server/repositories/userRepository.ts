import { eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { users } from '../../database/schema';

export const userRepository = {
  findAll: () => db.select().from(users).all(),
  findById: (id: string) => db.select().from(users).where(eq(users.id, id)).get(),
  findByEmail: (email: string) => db.select().from(users).where(eq(users.email, email.toLowerCase().trim())).get(),
};
