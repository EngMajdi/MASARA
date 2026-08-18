import { etaAccuracyRepository } from '../repositories/etaAccuracyRepository';
import { journeyRepository } from '../repositories/journeyRepository';
import { getBusEta } from './EtaService';
import { ACCURACY_BAND_SECONDS, HORIZON_BUCKETS, type AccuracyBand, type AccuracyBreakdownGroup, type AccuracyMetrics, type AccuracySample } from '../domain/etaAccuracyContract';
import type { EtaConfidence, EtaSource } from '../domain/etaContract';

// Phase 4E — ETA accuracy validation. Compares Phase 4D's live, deterministic
// ETA against the ONE authoritative "actual arrival" fact this domain has —
// `journeys.droppedOffAt` (set only by the driver-triggered
// JourneyService.dropOffStudent transition, never by GPS proximity, never by
// the ETA reaching zero, never by simulation completion). This file imports
// NO mutating function from JourneyService, TelemetryIngestionService,
// CurrentLocationProjectionService, ActionExecutor, PolicyEngine, or
// MasaraOperationsAgent — same governance boundary discipline as every prior
// telemetry/ETA phase, held by simple absence.
//
// GROUND TRUTH (architecture audit finding): a Journey's `droppedOffAt` +
// `currentStopId` (journeyRepository.findByTripId, a pure read) is the only
// server-set, driver-triggered "the bus actually reached this stop" fact in
// the schema. `audit_logs` rows for the dropped_off transition do NOT carry
// stopId in their metadata, so `journeys` itself is the only reliable
// source. Multiple students can be dropped off at the same stop on the same
// trip; this service takes the EARLIEST droppedOffAt among them as "when the
// bus arrived at that stop" — a deterministic aggregation (MIN) over real,
// already-persisted timestamps, never an invented or approximated value.
//
// SCOPE LIMITATION (documented, not an oversight): only next-stop-level
// predictions are validated. A prediction toward the final destination (the
// school itself — EtaWaypoint.stopId is null there) has no comparable ground
// truth anywhere in this schema: `trips.completedAt` is a defined column but
// no code path in this repository ever writes to it. Extending accuracy
// validation to whole-trip completion would require either inventing a
// "trip completed" signal (an unreviewed, out-of-scope schema/behavior
// change) or fabricating one from GPS proximity — both explicitly forbidden.
// This gap is reported honestly in the Phase 4E final report rather than
// worked around.
//
// WRITE-TRIGGER ARCHITECTURE (a deliberate departure from a naive
// "read-triggers-write on every GET", worth documenting once): snapshot
// CAPTURE happens at the same two existing write entry points Phase 4C's
// projection hook already uses — GpsSimulationEngine's tick and
// TelemetryIngestionService's ingest — never inside etaRoutes.ts's GET
// handlers. This keeps Phase 4D's already-shipped, already-tested endpoints
// completely untouched (zero regression risk) and avoids turning every
// EtaPanel poll into a write. RECONCILIATION (matching a later real arrival
// to an earlier snapshot) has no other natural trigger point — there is no
// server timer in this architecture and dropOffStudent's own call site
// (journeyRoutes.ts) is deliberately left unmodified per the "no unreviewed
// cross-phase change" discipline — so it runs lazily, on-demand, the first
// time this phase's own NEW read endpoints (`/api/eta/accuracy/summary`,
// `/api/eta/accuracy/trips/:tripId`) are called. This is the only write
// those two new endpoints perform, and it is bounded, idempotent, and
// deterministic: the same historical journeys/snapshots always reconcile to
// the same result regardless of how many times or in what order it runs.

const CONFIDENCE_ORDER: EtaConfidence[] = ['HIGH', 'MEDIUM', 'LOW'];
const SOURCE_ORDER: EtaSource[] = ['TELEMETRY', 'SIMULATION'];
const HORIZON_ORDER = HORIZON_BUCKETS.map((b) => b.label);

type MeasurableSample = AccuracySample & { actualArrivalAt: Date; signedErrorSeconds: number; absoluteErrorSeconds: number };

function isMeasurable(sample: AccuracySample): sample is MeasurableSample {
  return sample.actualArrivalAt != null && sample.signedErrorSeconds != null && sample.absoluteErrorSeconds != null;
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function horizonBucketLabel(predictedArrivalAt: Date, predictionTimestamp: Date): string {
  const minutes = (predictedArrivalAt.getTime() - predictionTimestamp.getTime()) / 60000;
  for (const bucket of HORIZON_BUCKETS) {
    if (minutes < bucket.maxMinutes) return bucket.label;
  }
  return HORIZON_BUCKETS[HORIZON_BUCKETS.length - 1].label;
}

function breakdownBy(measurable: MeasurableSample[], keyOrder: string[], keyFn: (s: MeasurableSample) => string): AccuracyBreakdownGroup[] {
  const result: AccuracyBreakdownGroup[] = [];
  for (const key of keyOrder) {
    const group = measurable.filter((s) => keyFn(s) === key);
    if (group.length === 0) continue;
    result.push({
      group: key,
      sampleCount: group.length,
      maeSeconds: average(group.map((s) => s.absoluteErrorSeconds)),
      biasSeconds: average(group.map((s) => s.signedErrorSeconds)),
    });
  }
  return result;
}

/**
 * Pure, deterministic metric computation over already-fetched samples — no
 * DB access, directly unit-testable with a hand-picked array (spec: "MAE/bias
 * on a known manually-computable sample set"). Never divides by zero: every
 * average/percentage is null, not a fabricated 0, when measurableSamples is 0.
 */
export function computeAccuracyMetrics(samples: AccuracySample[]): AccuracyMetrics {
  const totalCandidates = samples.length;
  const measurable = samples.filter(isMeasurable);
  const measurableSamples = measurable.length;
  const coverage = totalCandidates > 0 ? measurableSamples / totalCandidates : null;

  const maeSeconds = measurableSamples > 0 ? average(measurable.map((s) => s.absoluteErrorSeconds)) : null;
  const biasSeconds = measurableSamples > 0 ? average(measurable.map((s) => s.signedErrorSeconds)) : null;

  const bands: AccuracyBand[] = ACCURACY_BAND_SECONDS.map((withinSeconds) => {
    const count = measurable.filter((s) => s.absoluteErrorSeconds <= withinSeconds).length;
    return { withinSeconds, sampleCount: count, percentage: measurableSamples > 0 ? (count / measurableSamples) * 100 : null };
  });

  return {
    totalCandidates,
    measurableSamples,
    coverage,
    maeSeconds,
    biasSeconds,
    bands,
    byConfidence: breakdownBy(measurable, CONFIDENCE_ORDER, (s) => s.confidence),
    bySource: breakdownBy(measurable, SOURCE_ORDER, (s) => s.predictionSource),
    byHorizon: breakdownBy(measurable, HORIZON_ORDER, (s) => horizonBucketLabel(s.predictedArrivalAt, s.predictionTimestamp)),
  };
}

/**
 * The single snapshot-capture entry point (called from GpsSimulationEngine's
 * tick and TelemetryIngestionService's ingest path, mirroring
 * CurrentLocationProjectionService.processObservation's own contract). Never
 * throws — a snapshot-capture failure must never block the producer's own
 * authoritative work. Only captures when the ETA is a live, calculable
 * estimate toward a real next stop (ON_TIME/DELAYED, a resolved nextStopId)
 * — never for STALE/UNKNOWN estimates, which have nothing meaningful to
 * validate later.
 */
export function captureEtaAccuracySnapshot(busId: string): void {
  try {
    const eta = getBusEta(busId);
    if (eta.status !== 'ON_TIME' && eta.status !== 'DELAYED') return;
    if (!eta.tripId || !eta.nextStopId || !eta.estimatedArrivalAt || !eta.source) return;
    etaAccuracyRepository.insertSnapshotIfAbsent({
      tripId: eta.tripId,
      busId: eta.busId,
      stopId: eta.nextStopId,
      predictionTimestamp: eta.calculatedAt,
      predictedArrivalAt: eta.estimatedArrivalAt,
      confidence: eta.confidence,
      predictionSource: eta.source,
    });
  } catch (err) {
    console.error('EtaAccuracyService: failed to capture snapshot (non-fatal — accuracy tracking is best-effort derived state):', err);
  }
}

/**
 * Reconciles every pending (unreconciled) snapshot for one trip against that
 * trip's real Journey drop-off facts. Reads ONLY journeyRepository.findByTripId
 * (a pure read) — never audit_logs, never telemetry, never GPS proximity.
 * Returns the number of rows newly reconciled.
 */
export function reconcileTripAccuracy(tripId: string): number {
  const pending = etaAccuracyRepository.findPendingByTripId(tripId);
  if (pending.length === 0) return 0;

  const journeys = journeyRepository.findByTripId(tripId);
  const earliestDropoffByStop = new Map<string, Date>();
  for (const journey of journeys) {
    if (!journey.droppedOffAt || !journey.currentStopId) continue;
    const existing = earliestDropoffByStop.get(journey.currentStopId);
    if (!existing || journey.droppedOffAt.getTime() < existing.getTime()) {
      earliestDropoffByStop.set(journey.currentStopId, journey.droppedOffAt);
    }
  }

  let reconciledCount = 0;
  for (const row of pending) {
    const actualArrivalAt = earliestDropoffByStop.get(row.stopId);
    if (!actualArrivalAt) continue;
    const signedErrorSeconds = Math.round((row.predictedArrivalAt.getTime() - actualArrivalAt.getTime()) / 1000);
    etaAccuracyRepository.markReconciled(row.id, {
      actualArrivalAt,
      actualSource: 'JOURNEY_DROPOFF',
      signedErrorSeconds,
      absoluteErrorSeconds: Math.abs(signedErrorSeconds),
    });
    reconciledCount++;
  }
  return reconciledCount;
}

/** Bounded fleet-wide reconciliation pass (spec "no N+1"): at most a bounded number of pending trips, each individually bounded. A failure reconciling one trip is logged and never blocks the others. */
export function reconcileAllPendingAccuracy(): number {
  let total = 0;
  for (const tripId of etaAccuracyRepository.findPendingTripIds()) {
    try {
      total += reconcileTripAccuracy(tripId);
    } catch (err) {
      console.error(`EtaAccuracyService: failed to reconcile trip ${tripId} (skipped, others continue):`, err);
    }
  }
  return total;
}

export type AccuracySourceMix = 'TELEMETRY' | 'SIMULATION' | 'MIXED' | 'NONE';

export interface AccuracyView {
  metrics: AccuracyMetrics;
  /** Lets the UI clearly distinguish LIVE/SIMULATION/MIXED data — simulation must never masquerade as real-world accuracy. */
  sourceMix: AccuracySourceMix;
}

function buildView(rows: ReturnType<typeof etaAccuracyRepository.findForMetrics>): AccuracyView {
  const samples: AccuracySample[] = rows.map((r) => ({
    confidence: r.confidence as EtaConfidence,
    predictionSource: r.predictionSource as EtaSource,
    predictionTimestamp: r.predictionTimestamp,
    predictedArrivalAt: r.predictedArrivalAt,
    actualArrivalAt: r.actualArrivalAt,
    signedErrorSeconds: r.signedErrorSeconds,
    absoluteErrorSeconds: r.absoluteErrorSeconds,
  }));
  const metrics = computeAccuracyMetrics(samples);
  const sources = new Set(samples.map((s) => s.predictionSource));
  const sourceMix: AccuracySourceMix = sources.size === 0 ? 'NONE' : sources.size > 1 ? 'MIXED' : (sources.values().next().value as AccuracySourceMix);
  return { metrics, sourceMix };
}

/** Reconciles (bounded, on-demand — see header comment), then computes metrics scoped to one trip. Honestly returns an empty view (never a 404-shaped fabrication) for a trip with no captured snapshots yet. */
export function getTripEtaAccuracy(tripId: string): AccuracyView {
  reconcileTripAccuracy(tripId);
  return buildView(etaAccuracyRepository.findForMetrics({ tripId }));
}

/** Reconciles (bounded, on-demand), then computes fleet-wide metrics. */
export function getSummaryEtaAccuracy(): AccuracyView {
  reconcileAllPendingAccuracy();
  return buildView(etaAccuracyRepository.findForMetrics({}));
}
