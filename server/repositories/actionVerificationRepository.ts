import { eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { actionVerifications } from '../../database/schema';

type NewVerification = typeof actionVerifications.$inferInsert;

export const actionVerificationRepository = {
  create: (verification: NewVerification) => {
    const row = { id: crypto.randomUUID(), ...verification };
    db.insert(actionVerifications).values(row).run();
    return row;
  },
  findByActionId: (actionId: string) =>
    db.select().from(actionVerifications).where(eq(actionVerifications.actionId, actionId)).all(),
  /** Scoped cleanup when the owning action is being removed (trip deletion's own FK chain) — never a blanket wipe. */
  deleteByActionId: (actionId: string) => db.delete(actionVerifications).where(eq(actionVerifications.actionId, actionId)).run(),
};
