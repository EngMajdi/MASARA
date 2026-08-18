// Phase 4E — ETA accuracy domain contract. Pure types and centrally-named
// constants only (no logic, matching etaContract.ts's own convention).
// Nothing here is an AI/ML output — every metric is plain, deterministic
// arithmetic over persisted prediction snapshots and the one authoritative
// "actual arrival" fact this domain has (journeys.droppedOffAt).

import type { EtaConfidence, EtaSource } from './etaContract';

/** The only actual-arrival source this phase implements — a driver-triggered Journey drop-off, never GPS proximity, never ETA-reaching-zero, never simulation completion. */
export type ActualArrivalSource = 'JOURNEY_DROPOFF';

/** ±1 / ±3 / ±5 / ±10 minutes, expressed in seconds — the fixed accuracy-band thresholds (never invented per-call). */
export const ACCURACY_BAND_SECONDS = [60, 180, 300, 600] as const;

/** Prediction-horizon bins in minutes, upper-bound exclusive except the last (open-ended). */
export const HORIZON_BUCKETS = [
  { label: '0-2', maxMinutes: 2 },
  { label: '2-5', maxMinutes: 5 },
  { label: '5-10', maxMinutes: 10 },
  { label: '10-20', maxMinutes: 20 },
  { label: '20+', maxMinutes: Infinity },
] as const;

export type HorizonBucketLabel = (typeof HORIZON_BUCKETS)[number]['label'];

export interface AccuracySample {
  confidence: EtaConfidence;
  predictionSource: EtaSource;
  predictionTimestamp: Date;
  predictedArrivalAt: Date;
  actualArrivalAt: Date | null;
  signedErrorSeconds: number | null;
  absoluteErrorSeconds: number | null;
}

export interface AccuracyBand {
  withinSeconds: number;
  sampleCount: number;
  /** null (never a fabricated 0%) when measurableSamples is 0. */
  percentage: number | null;
}

export interface AccuracyBreakdownGroup {
  group: string;
  sampleCount: number;
  maeSeconds: number | null;
  biasSeconds: number | null;
}

/**
 * The full metrics result. `measurableSamples` is always shown alongside
 * any percentage/average (spec: "sample count always shown alongside any
 * percentage") — a caller must never render maeSeconds/biasSeconds/bands
 * without also rendering measurableSamples next to them. When
 * measurableSamples is 0, maeSeconds/biasSeconds/coverage are null and
 * every band's percentage is null — never a fabricated 0%.
 */
export interface AccuracyMetrics {
  totalCandidates: number;
  measurableSamples: number;
  /** measurableSamples / totalCandidates — a data-completeness signal, never confused with accuracy itself. */
  coverage: number | null;
  maeSeconds: number | null;
  /** Sign convention: predicted - actual. Positive = ETA predicted later than the bus actually arrived. */
  biasSeconds: number | null;
  bands: AccuracyBand[];
  byConfidence: AccuracyBreakdownGroup[];
  bySource: AccuracyBreakdownGroup[];
  byHorizon: AccuracyBreakdownGroup[];
}
