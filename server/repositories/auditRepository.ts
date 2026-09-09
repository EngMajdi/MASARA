import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { db } from '../../database/client';
import { auditLogs } from '../../database/schema';

type NewAuditLog = typeof auditLogs.$inferInsert;

export interface AuditLogFilter {
  tripId?: string;
  studentId?: string;
  recommendationId?: string;
  entityType?: string;
  entityId?: string;
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
  findByStudentId: (studentId: string) =>
    db.select().from(auditLogs).where(eq(auditLogs.studentId, studentId)).orderBy(desc(auditLogs.createdAt)).all(),
  /** Journey timeline (spec §38) — one entity's full event history, oldest first. */
  findByEntity: (entityType: string, entityId: string) =>
    db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)))
      .orderBy(auditLogs.createdAt)
      .all(),

  /** Backs the Operations Feed — a single indexed query, no N+1 joins. */
  findFiltered: (filter: AuditLogFilter) => {
    const conditions = [];
    if (filter.tripId) conditions.push(eq(auditLogs.tripId, filter.tripId));
    if (filter.studentId) conditions.push(eq(auditLogs.studentId, filter.studentId));
    if (filter.recommendationId) conditions.push(eq(auditLogs.recommendationId, filter.recommendationId));
    if (filter.entityType) conditions.push(eq(auditLogs.entityType, filter.entityType));
    if (filter.entityId) conditions.push(eq(auditLogs.entityId, filter.entityId));
    if (filter.eventTypes && filter.eventTypes.length > 0) conditions.push(inArray(auditLogs.eventType, filter.eventTypes));
    if (filter.since) conditions.push(gt(auditLogs.createdAt, filter.since));

    const query = db
      .select()
      .from(auditLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLogs.createdAt));

    return filter.limit ? query.limit(filter.limit).all() : query.all();
  },

  /**
   * The one exception to "immutable, append-only, no UPDATE/DELETE route"
   * (see this table's own schema comment): when the owning trip is
   * removed, its denormalized tripId reference on historical audit rows
   * would otherwise dangle. This clears ONLY that one column (tripId ->
   * null, exactly like telemetry_observations' own documented "historical
   * correlation survives a stale reference" precedent) — eventType,
   * actorId, previousState, newState, and metadata are never touched, so
   * the actual historical fact this row records is unchanged.
   */
  clearTripId: (tripId: string) => db.update(auditLogs).set({ tripId: null }).where(eq(auditLogs.tripId, tripId)).run(),
};
