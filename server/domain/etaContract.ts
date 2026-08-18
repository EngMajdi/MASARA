// Phase 4D — ETA domain contract. Deterministic, explainable intelligence
// over the Phase 4C current-location projection + existing route geometry.
// Nothing here is an LLM output, a random number, or fabricated traffic
// data (spec §4/§22) — every field is either read from an existing
// repository or computed with plain arithmetic, and every computation is
// reproducible from the same inputs.

export type EtaStatus = 'ON_TIME' | 'DELAYED' | 'STALE' | 'UNKNOWN';
export type EtaConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
/** Never accepted from a client (spec §3) — always derived from the trusted producer of the underlying current-location projection row. */
export type EtaSource = 'TELEMETRY' | 'SIMULATION';

// ---------------------------------------------------------------------------
// Centralized constants (spec §49 — never scatter magic numbers across
// files). Nothing here duplicates an existing named constant: PredictionEngine's
// own risk thresholds (delayMinutes >= 8/3) are inline, unnamed, and answer a
// DIFFERENT question (governed recommendation risk from trip.currentEtaAt vs
// trip.targetArrivalAt) than these do (a live, telemetry-derived ETA delay
// classification) — see EtaService's header comment for the full boundary.
// ---------------------------------------------------------------------------

/** Used only when no valid current or recent telemetry speed is available (spec §5, tier 3). Matches GpsSimulationEngine's own NORMAL profile value, deliberately, for consistent demo behavior — not imported from there, since it's a conceptually distinct "real-world fallback assumption", not a simulation speed profile. */
export const DEFAULT_ETA_SPEED_KMH = 30;

/** A speed above this is treated as physically implausible for a school bus and rejected as an input (spec §6 "impossible speed"). */
export const ETA_MAX_REASONABLE_SPEED_KMH = 120;

/** How many of the bus's most recent telemetry observations to consider for the "recent observed speed" fallback tier (spec §5, tier 2). */
export const ETA_RECENT_SPEED_SAMPLE_SIZE = 5;

/** delaySeconds beyond this (vs. trip.targetArrivalAt) is a MINOR_DELAY finding. */
export const ETA_MINOR_DELAY_THRESHOLD_SECONDS = 5 * 60;

/** delaySeconds beyond this is a SIGNIFICANT_DELAY finding — a genuine candidate for the existing governed recommendation workflow (spec §21/§24), never created automatically here. */
export const ETA_SIGNIFICANT_DELAY_THRESHOLD_SECONDS = 10 * 60;

export type DelayClassification = 'ON_TIME' | 'MINOR_DELAY' | 'SIGNIFICANT_DELAY';

export interface EtaExplanation {
  /** Short, human-readable Arabic reason — never a fabricated cause like "traffic" unless an actual signal exists (spec §22). */
  reason: string;
  freshLocation: boolean;
  validSpeed: boolean;
  routeGeometryAvailable: boolean;
}

/**
 * One ETA estimate for one bus. Purely a computed, in-memory value —
 * never persisted (spec §28: no migration, no table). Every field is
 * either copied from an existing trusted row or arithmetic over it.
 */
export interface EtaEstimate {
  busId: string;
  tripId: string | null;
  routeId: string | null;
  nextStopId: string | null;
  nextStopName: string | null;
  estimatedArrivalAt: Date | null;
  finalDestinationEtaAt: Date | null;
  remainingDistanceMeters: number | null;
  remainingToDestinationMeters: number | null;
  estimatedTravelSeconds: number | null;
  currentSpeedKmh: number | null;
  effectiveSpeedKmh: number | null;
  confidence: EtaConfidence;
  status: EtaStatus;
  source: EtaSource | null;
  calculatedAt: Date;
  explanation: EtaExplanation;
  /** Present only when a legitimate schedule (trips.targetArrivalAt) and a calculable ETA both exist (spec §21). */
  delay: {
    scheduledArrivalAt: Date;
    delaySeconds: number;
    classification: DelayClassification;
  } | null;
}

/**
 * Structured input MasaraOperationsAgent (or a future caller) could accept
 * if an ETA-derived operational finding is ever wired into the existing
 * governed recommendation pipeline (spec §21/§24/§25). NOT constructed or
 * consumed anywhere in Phase 4D — see EtaService's header comment for why
 * this stays a documented extension point rather than a live integration.
 */
export interface EtaOperationalFinding {
  busId: string;
  tripId: string;
  routeId: string | null;
  nextStopId: string | null;
  remainingDistanceMeters: number | null;
  currentSpeedKmh: number | null;
  estimatedArrivalAt: string;
  status: EtaStatus;
  confidence: EtaConfidence;
  calculatedAt: string;
  delaySeconds: number;
  classification: DelayClassification;
}

/**
 * The estimator abstraction (spec §52) — DeterministicEtaEstimator is the
 * only Phase 4D implementation. A future MLBasedEtaEstimator could
 * implement the same interface without EtaService's callers changing.
 */
export interface EtaEstimator {
  estimate(context: EtaEstimationContext): EtaEstimate;
}

export interface EtaWaypoint {
  lat: number;
  lng: number;
  stopId: string | null;
  name: string;
}

export interface EtaEstimationContext {
  busId: string;
  tripId: string | null;
  routeId: string | null;
  scheduledArrivalAt: Date | null;
  currentLocation: {
    lat: number;
    lng: number;
    speedKmh: number | null;
    occurredAt: Date;
    receivedAt: Date;
    source: EtaSource;
    isFresh: boolean;
  } | null;
  /** Ordered route stops + the school as the final waypoint — same convention as GpsSimulationEngine's own waypoint resolution (Phase 4A). */
  waypoints: EtaWaypoint[];
  /** Bounded recent speed samples for this bus, most recent first (spec §5 tier 2, §46 "bounded recent window"). */
  recentSpeedSamplesKmh: number[];
  now: Date;
}
