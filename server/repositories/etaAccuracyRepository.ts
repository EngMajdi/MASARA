import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../database/client';
import { etaAccuracyObservations } from '../../database/schema';

export interface SnapshotCandidate {
  tripId: string;
  busId: string;
  stopId: string;
  predictionTimestamp: Date;
  predictedArrivalAt: Date;
  confidence: string;
  predictionSource: string;
}

export interface ReconciliationUpdate {
  actualArrivalAt: Date;
  actualSource: string;
  signedErrorSeconds: number;
  absoluteErrorSeconds: number;
}

const METRICS_FETCH_LIMIT = 2000;
const RECONCILE_TRIP_LIMIT = 200;
const RECONCILE_ROW_LIMIT = 200;

export const etaAccuracyRepository = {
  /**
   * The real, database-level duplicate-prevention write (the unique index on
   * (trip_id, stop_id, prediction_bucket_at) — never app-level dedup). Uses
   * `INSERT ... ON CONFLICT DO NOTHING` so the FIRST snapshot captured within
   * a given 60-second bucket for a given (trip, stop) wins and later polls
   * in the same bucket are silent no-ops — bounding write volume regardless
   * of how often a producer calls this.
   */
  insertSnapshotIfAbsent: (candidate: SnapshotCandidate) => {
    const predictionTimestampSec = Math.floor(candidate.predictionTimestamp.getTime() / 1000);
    const predictedArrivalAtSec = Math.floor(candidate.predictedArrivalAt.getTime() / 1000);
    const bucketSec = Math.floor(predictionTimestampSec / 60) * 60;
    const nowSec = Math.floor(Date.now() / 1000);
    db.run(sql`
      INSERT INTO eta_accuracy_observations
        (id, trip_id, bus_id, stop_id, prediction_timestamp, prediction_bucket_at, predicted_arrival_at, confidence, prediction_source, created_at, updated_at)
      VALUES
        (${crypto.randomUUID()}, ${candidate.tripId}, ${candidate.busId}, ${candidate.stopId}, ${predictionTimestampSec}, ${bucketSec}, ${predictedArrivalAtSec},
         ${candidate.confidence}, ${candidate.predictionSource}, ${nowSec}, ${nowSec})
      ON CONFLICT(trip_id, stop_id, prediction_bucket_at) DO NOTHING
    `);
  },

  /** Bounded — at most RECONCILE_TRIP_LIMIT distinct trips per call (spec "no N+1 / bounded"). */
  findPendingTripIds: (): string[] => {
    const rows = db
      .selectDistinct({ tripId: etaAccuracyObservations.tripId })
      .from(etaAccuracyObservations)
      .where(isNull(etaAccuracyObservations.actualArrivalAt))
      .limit(RECONCILE_TRIP_LIMIT)
      .all();
    return rows.map((r) => r.tripId);
  },

  /** Bounded pending (unreconciled) rows for one trip. */
  findPendingByTripId: (tripId: string) =>
    db
      .select()
      .from(etaAccuracyObservations)
      .where(and(eq(etaAccuracyObservations.tripId, tripId), isNull(etaAccuracyObservations.actualArrivalAt)))
      .limit(RECONCILE_ROW_LIMIT)
      .all(),

  /** The only write path onto a row after its initial insert — fills the actual-arrival fields exactly once, deterministically, from server-derived values only (never a client-supplied actualArrivalAt). */
  markReconciled: (id: string, update: ReconciliationUpdate) => {
    db.update(etaAccuracyObservations)
      .set({
        actualArrivalAt: update.actualArrivalAt,
        actualSource: update.actualSource,
        signedErrorSeconds: update.signedErrorSeconds,
        absoluteErrorSeconds: update.absoluteErrorSeconds,
        updatedAt: new Date(),
      })
      .where(eq(etaAccuracyObservations.id, id))
      .run();
  },

  /** Bounded read for metrics computation — most recent first, capped so an unbounded history can never be pulled fully into memory. */
  findForMetrics: (filter: { tripId?: string } = {}) =>
    db
      .select()
      .from(etaAccuracyObservations)
      .where(filter.tripId ? eq(etaAccuracyObservations.tripId, filter.tripId) : undefined)
      .orderBy(desc(etaAccuracyObservations.predictionTimestamp))
      .limit(METRICS_FETCH_LIMIT)
      .all(),

  clear: () => db.delete(etaAccuracyObservations).run(),
};
