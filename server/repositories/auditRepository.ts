import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { db } from '../../database/client';
import { auditLogs } from '../../database/schema';

type NewAuditLog = typeof auditLogs.$inferInsert;

export interface AuditLogFilter {
  tripId?: string;
  recommendationId?: string;
  eventTypes?: string[];
  since?: Date;
  limit?: number;
}

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
  findByTripId: (tripId: string) =>
    db.select().from(auditLogs).where(eq(auditLogs.tripId, tripId)).orderBy(desc(auditLogs.createdAt)).all(),

  /** Backs the Operations Feed — a single indexed query, no N+1 joins. */
  findFiltered: (filter: AuditLogFilter) => {
    const conditions = [];
    if (filter.tripId) conditions.push(eq(auditLogs.tripId, filter.tripId));
    if (filter.recommendationId) conditions.push(eq(auditLogs.recommendationId, filter.recommendationId));
    if (filter.eventTypes && filter.eventTypes.length > 0) conditions.push(inArray(auditLogs.eventType, filter.eventTypes));
    if (filter.since) conditions.push(gt(auditLogs.createdAt, filter.since));

    const query = db
      .select()
      .from(auditLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLogs.createdAt));

    return filter.limit ? query.limit(filter.limit).all() : query.all();
  },
};
