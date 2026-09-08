import { currentLocationProjectionRepository } from '../repositories/currentLocationProjectionRepository';
import type { TelemetryObservation } from '../domain/telemetryContract';

// Phase 4C — a derived, read-optimized projection over Phase 4B's immutable
// `telemetry_observations` history. This service is the ONLY writer of
// `current_location_projection` (spec §28's mandatory "no endpoint writes
// projection state directly" holds because nothing but this file and its
// repository ever touches that table).
//
// Architecture:
//
//   telemetry_observations (Phase 4B, immutable historical truth)
//           |
//           v  (TelemetryIngestionService calls processObservation after a
//           |   successful, already-validated, already-persisted write)
//   CurrentLocationProjectionService.processObservation()
//           ^
//           |  (GpsSimulationEngine calls processObservation directly,
//           |   in-memory, after each deterministic tick)
//   GpsSimulationEngine (Phase 4A)
//           |
//           v
//   current_location_projection (Phase 4C, one row per bus, derived)
//
// IMPORTANT DESIGN DECISION (documented per spec §54's stop-condition
// discipline, since a literal reading of spec §19/§36's "telemetry_observation
// -> current_location_projection" arrow could be misread as requiring
// simulation ticks to be written into telemetry_observations): a SIMULATION
// observation is NEVER persisted into telemetry_observations. Phase 4B
// established, repeatedly and deliberately, that the simulator is never a
// registrable device (telemetry_observations.device_id is NOT NULL,
// referencing telemetry_devices, and TelemetryDeviceService.registerDevice
// explicitly rejects providerType 'SIMULATION'). Modifying that FK to allow
// a null device — or registering a fake "simulator device" — would violate
// two explicit prior-phase prohibitions ("do not modify telemetry_observations",
// "do not register the simulator as a fake physical device"). The resolution
// that satisfies every constraint simultaneously: this service's real input
// contract is the shared `TelemetryObservation` domain type (already
// produced identically by both GpsSimulationEngine and
// TelemetryIngestionService), not "a row that exists in telemetry_observations".
// Both producers call the same `processObservation`; only the DEVICE/
// GPS_PROVIDER path also durably persists to telemetry_observations first.
// One practical consequence, documented honestly rather than hidden: a
// currently-running simulation's projection entry is NOT recoverable by
// rebuildCurrentLocationProjection() (which can only scan
// telemetry_observations) — exactly mirroring Phase 4A's own documented
// "simulation sessions are in-memory only, lost on restart" limitation.

export type LocationSource = 'DEVICE' | 'GPS_PROVIDER' | 'SIMULATION' | 'DRIVER_PHONE';
export type Freshness = 'FRESH' | 'STALE';

// Configurable, documented (spec §10) — a prototype-reasonable default. Not
// derived from any production SLA; simply "recent enough to trust without
// a human double-checking".
export const CURRENT_LOCATION_STALE_AFTER_SECONDS = 60;

export interface CurrentLocationView {
  busId: string;
  tripId: string | null;
  observationId: string;
  sourceEventId: string;
  source: LocationSource;
  sequence: number | null;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  heading: number | null;
  accuracyMeters: number | null;
  occurredAt: Date;
  receivedAt: Date;
  updatedAt: Date;
  freshness: Freshness;
}

type ProjectionRow = NonNullable<ReturnType<typeof currentLocationProjectionRepository.findByBusId>>;

export function deriveFreshness(receivedAt: Date, now: Date = new Date()): Freshness {
  const ageSeconds = (now.getTime() - receivedAt.getTime()) / 1000;
  return ageSeconds <= CURRENT_LOCATION_STALE_AFTER_SECONDS ? 'FRESH' : 'STALE';
}

function toView(row: ProjectionRow, now: Date = new Date()): CurrentLocationView {
  return {
    busId: row.busId,
    tripId: row.tripId,
    observationId: row.observationId,
    sourceEventId: row.sourceEventId,
    source: row.source as LocationSource,
    sequence: row.sequence,
    latitude: row.latitude,
    longitude: row.longitude,
    speedKmh: row.speedKmh,
    heading: row.heading,
    accuracyMeters: row.accuracyMeters,
    occurredAt: row.occurredAt,
    receivedAt: row.receivedAt,
    updatedAt: row.updatedAt,
    freshness: deriveFreshness(row.receivedAt, now),
  };
}

/**
 * The single entry point both trusted producers call (spec §7/§20). Never
 * throws — a projection failure must never roll back or block the
 * producer's own authoritative work (an already-persisted telemetry row,
 * or an already-completed simulation tick); it is logged and swallowed,
 * exactly like any other best-effort derived read-model maintenance.
 * Internally idempotent and race-safe purely because
 * `currentLocationProjectionRepository.upsertIfNewer` is (spec §6/§8).
 */
export function processObservation(observation: TelemetryObservation): void {
  try {
    currentLocationProjectionRepository.upsertIfNewer({
      busId: observation.busId,
      tripId: observation.tripId ?? null,
      observationId: observation.observationId,
      sourceEventId: observation.sourceEventId,
      source: observation.source,
      sequence: observation.sequence,
      latitude: observation.latitude,
      longitude: observation.longitude,
      speedKmh: observation.speed ?? null,
      heading: observation.heading ?? null,
      accuracyMeters: observation.accuracy ?? null,
      occurredAt: observation.occurredAt,
      receivedAt: observation.receivedAt,
    });
  } catch (err) {
    console.error('CurrentLocationProjectionService: failed to process observation (non-fatal — projection is derived state):', err);
  }
}

/** Returns null (never fabricated coordinates — spec §42) if this bus has no projection yet. */
export function getCurrentLocation(busId: string): CurrentLocationView | null {
  const row = currentLocationProjectionRepository.findByBusId(busId);
  return row ? toView(row) : null;
}

/** One bounded query, not N+1 (spec §16/§40). */
export function listFleetCurrentLocations(): CurrentLocationView[] {
  const now = new Date();
  return currentLocationProjectionRepository.findAll().map((row) => toView(row, now));
}

/**
 * Rebuilds the entire projection from telemetry_observations (spec §21/§22)
 * — DEVICE/GPS_PROVIDER history only, per the design decision documented
 * above. Not exposed as an HTTP endpoint in this phase (spec §21: "prefer
 * keeping rebuild as a service/test capability").
 */
export function rebuildCurrentLocationProjection(): void {
  currentLocationProjectionRepository.rebuildFromTelemetryHistory();
}
