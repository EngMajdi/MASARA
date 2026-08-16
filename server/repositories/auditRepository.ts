import { desc, eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { auditLogs } from '../../database/schema';

type NewAuditLog = typeof auditLogs.$inferInsert;

export const auditRepository = {
  create: (entry: NewAuditLog) => {
    const row = { id: crypto.randomUUID(), ...entry };
    db.insert(auditLogs).values(row).run();
    return row;
  },
  findAll: () => db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).all(),
  findByAgentRunId: (agentRunId: string) =>
    db.select().from(auditLogs).where(eq(auditLogs.agentRunId, agentRunId)).all(),
  findByRecommendationId: (recommendationId: string) =>
    db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.recommendationId, recommendationId))
      .orderBy(desc(auditLogs.createdAt))
      .all(),
};
