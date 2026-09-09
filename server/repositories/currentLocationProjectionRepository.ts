import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../database/client';
import { currentLocationProjection } from '../../database/schema';

export interface ProjectionCandidate {
  busId: string;
  tripId: string | null;
  observationId: string;
  sourceEventId: string;
  source: string;
  sequence: number | null;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  heading: number | null;
  accuracyMeters: number | null;
  occurredAt: Date;
  receivedAt: Date;
}

export const currentLocationProjectionRepository = {
  findByBusId: (busId: string) => db.select().from(currentLocationProjection).where(eq(currentLocationProjection.busId, busId)).get(),
  findAll: () => db.select().from(currentLocationProjection).all(),
  findByBusIds: (busIds: string[]) =>
    busIds.length === 0 ? [] : db.select().from(currentLocationProjection).where(inArray(currentLocationProjection.busId, busIds)).all(),

  /**
   * The one write path onto this table (spec §8/§28 mandatory test — "no
   * endpoint allows clients to write projection state directly"; this is a
   * repository method, never reachable from a route body). A SINGLE atomic
   * SQLite upsert — not a SELECT-then-decide-then-write — so the ordering
   * guarantee holds even under two "concurrent" calls (spec §32): the
   * `WHERE` clause on the `ON CONFLICT` arm is evaluated by SQLite itself
   * against the row as it exists at that instant, so an older observation
   * arriving after a newer one is silently a no-op, never a regression.
   *
   * Ordering policy (spec §4, documented once, here — the only place this
   * decision is made): occurredAt DESC, then receivedAt DESC, then
   * sequence DESC (NULL treated as lower than any real sequence), then
   * observationId DESC as the final deterministic tie-breaker.
   */
  upsertIfNewer: (candidate: ProjectionCandidate) => {
    // Integer Unix-seconds, truncated exactly like every other `mode:
    // 'timestamp'` column in this schema (raw sql bypasses drizzle's own
    // column transformer, so this has to be done by hand) — keeps this
    // table consistent with the established "seconds, not milliseconds"
    // storage convention the rest of the codebase already works around.
    const occurredAtSec = Math.floor(candidate.occurredAt.getTime() / 1000);
    const receivedAtSec = Math.floor(candidate.receivedAt.getTime() / 1000);
    const nowSec = Math.floor(Date.now() / 1000);
    db.run(sql`
      INSERT INTO current_location_projection
        (bus_id, trip_id, observation_id, source_event_id, source, sequence, latitude, longitude, speed_kmh, heading, accuracy_meters, occurred_at, received_at, updated_at)
      VALUES
        (${candidate.busId}, ${candidate.tripId}, ${candidate.observationId}, ${candidate.sourceEventId}, ${candidate.source}, ${candidate.sequence},
         ${candidate.latitude}, ${candidate.longitude}, ${candidate.speedKmh}, ${candidate.heading}, ${candidate.accuracyMeters},
         ${occurredAtSec}, ${receivedAtSec}, ${nowSec})
      ON CONFLICT(bus_id) DO UPDATE SET
        trip_id = excluded.trip_id,
        observation_id = excluded.observation_id,
        source_event_id = excluded.source_event_id,
        source = excluded.source,
        sequence = excluded.sequence,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        speed_kmh = excluded.speed_kmh,
        heading = excluded.heading,
        accuracy_meters = excluded.accuracy_meters,
        occurred_at = excluded.occurred_at,
        received_at = excluded.received_at,
        updated_at = excluded.updated_at
      WHERE
        current_location_projection.occurred_at < excluded.occurred_at
        OR (current_location_projection.occurred_at = excluded.occurred_at AND current_location_projection.received_at < excluded.received_at)
        OR (current_location_projection.occurred_at = excluded.occurred_at AND current_location_projection.received_at = excluded.received_at
            AND IFNULL(current_location_projection.sequence, -1) < IFNULL(excluded.sequence, -1))
        OR (current_location_projection.occurred_at = excluded.occurred_at AND current_location_projection.received_at = excluded.received_at
            AND IFNULL(current_location_projection.sequence, -1) = IFNULL(excluded.sequence, -1)
            AND current_location_projection.observation_id < excluded.observation_id)
    `);
  },

  clear: () => db.delete(currentLocationProjection).run(),

  /** Scoped cleanup when a governed bus/trip is being removed — never a blanket wipe. */
  deleteByBusId: (busId: string) => db.delete(currentLocationProjection).where(eq(currentLocationProjection.busId, busId)).run(),
  deleteByTripId: (tripId: string) => db.delete(currentLocationProjection).where(eq(currentLocationProjection.tripId, tripId)).run(),

  /**
   * Rebuilds the entire projection from `telemetry_observations` in ONE
   * bounded query (spec §16/§21/§40 — no N+1, no per-bus loop) using a
   * window function to pick the winning row per bus under the exact same
   * ordering policy as upsertIfNewer. Only reconstructs DEVICE/GPS_PROVIDER
   * history — SIMULATION observations are never persisted to
   * telemetry_observations (see CurrentLocationProjectionService's header
   * comment) and are therefore not recoverable by rebuild; this is a
   * documented, intentional limitation, not an oversight.
   */
  rebuildFromTelemetryHistory: () => {
    const now = Math.floor(Date.now() / 1000);
    db.run(sql`DELETE FROM current_location_projection`);
    db.run(sql`
      INSERT INTO current_location_projection
        (bus_id, trip_id, observation_id, source_event_id, source, sequence, latitude, longitude, speed_kmh, heading, accuracy_meters, occurred_at, received_at, updated_at)
      SELECT bus_id, trip_id, id, source_event_id, source, sequence, latitude, longitude, speed_kmh, heading, accuracy_meters, occurred_at, received_at, ${now}
      FROM (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY bus_id
          ORDER BY occurred_at DESC, received_at DESC, IFNULL(sequence, -1) DESC, id DESC
        ) AS rn
        FROM telemetry_observations
      )
      WHERE rn = 1
    `);
  },
};
