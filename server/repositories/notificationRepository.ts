import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../database/client';
import { notifications } from '../../database/schema';

export interface NotificationCandidate {
  recipientUserId: string;
  studentId: string;
  journeyId: string;
  tripId: string;
  eventType: string;
  sourceEventId: string;
  category: string;
  title: string;
  body: string;
  priority: string;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export const notificationRepository = {
  /**
   * The one write path onto this table (spec §10/§28 — no route ever writes
   * here directly). `INSERT ... ON CONFLICT(recipient_user_id,
   * source_event_id) DO NOTHING` is the real, database-enforced
   * deduplication boundary — reprocessing the same trusted audit_logs row
   * for the same recipient is always a safe no-op, exactly the same
   * insert-or-ignore pattern already proven in
   * eta_accuracy_observations/current_location_projection. Newly created
   * rows start PENDING; the delivery provider transitions them to SENT/
   * FAILED immediately afterward (see NotificationService).
   */
  /** Returns the new row's id if this call actually created one, or null if it was a duplicate no-op (ON CONFLICT DO NOTHING + RETURNING — the caller uses this to know whether delivery needs to run, without a second lookup query). */
  insertIfAbsent: (candidate: NotificationCandidate): string | null => {
    const id = crypto.randomUUID();
    const nowSec = Math.floor(Date.now() / 1000);
    const row = db.get<{ id: string }>(sql`
      INSERT INTO notifications
        (id, recipient_user_id, student_id, journey_id, trip_id, event_type, source_event_id, category, title, body, priority, status, created_at, updated_at)
      VALUES
        (${id}, ${candidate.recipientUserId}, ${candidate.studentId}, ${candidate.journeyId}, ${candidate.tripId},
         ${candidate.eventType}, ${candidate.sourceEventId}, ${candidate.category}, ${candidate.title}, ${candidate.body}, ${candidate.priority},
         'PENDING', ${nowSec}, ${nowSec})
      ON CONFLICT(recipient_user_id, source_event_id) DO NOTHING
      RETURNING id
    `);
    return row?.id ?? null;
  },

  findById: (id: string) => db.select().from(notifications).where(eq(notifications.id, id)).get(),

  /** Bounded, newest-first (spec §29 — never unbounded, default 20 / max 50). */
  findByRecipient: (recipientUserId: string, limit = DEFAULT_LIMIT) => {
    const bounded = Math.min(MAX_LIMIT, Math.max(1, limit));
    return db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientUserId, recipientUserId))
      .orderBy(desc(notifications.createdAt))
      .limit(bounded)
      .all();
  },

  /** A single efficient COUNT query — never loads rows into memory to count them (spec §29). */
  countUnreadByRecipient: (recipientUserId: string): number => {
    const row = db
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(and(eq(notifications.recipientUserId, recipientUserId), isNull(notifications.readAt)))
      .get();
    return row?.count ?? 0;
  },

  markSent: (id: string) => db.update(notifications).set({ status: 'SENT', sentAt: new Date(), updatedAt: new Date() }).where(eq(notifications.id, id)).run(),

  markFailed: (id: string, reason: string) =>
    db.update(notifications).set({ status: 'FAILED', failureReason: reason, failedAt: new Date(), updatedAt: new Date() }).where(eq(notifications.id, id)).run(),

  /** Idempotent — marking an already-read notification read again is a harmless no-op (readAt is only ever set once, to its first value, via COALESCE). */
  markRead: (id: string) => {
    const nowSec = Math.floor(Date.now() / 1000);
    db.run(sql`UPDATE notifications SET read_at = COALESCE(read_at, ${nowSec}), updated_at = ${nowSec} WHERE id = ${id}`);
  },

  clear: () => db.delete(notifications).run(),
};
