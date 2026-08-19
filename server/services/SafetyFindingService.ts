import { getTripEta } from './EtaService';
import type { EtaEstimate, EtaConfidence, DelayClassification } from '../domain/etaContract';

// Phase 7B — Predictive Safety Intelligence, first Finding: SIGNIFICANT_DELAY_RISK.
// Approved scope (audit): Evidence -> Finding only. A SafetyFinding is NEVER
// an action, a recommendation, a notification, or an approval request — it
// is a read-time repackaging of an already-computed EtaEstimate
// (server/services/EtaService.ts), which itself never mutates anything.
// This file imports no repository write method, no JourneyService,
// JourneyStateMachine, ActionExecutor, PolicyEngine, TelemetryIngestionService,
// NotificationService, NotificationPolicy, or MasaraOperationsAgent — the
// governance boundary holds by simple absence, the same discipline
// EtaService/GpsSimulationEngine/TelemetryIngestionService already use.
//
// Ephemeral by design (audit "Persistence Decision"): no table, no
// migration. Every field is derived from the EtaEstimate passed in; nothing
// here is fabricated (no traffic/weather/ML/probability).

export type FindingConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type FindingSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface SafetyFinding {
  findingType: 'SIGNIFICANT_DELAY_RISK';
  busId: string;
  tripId: string;
  routeId: string | null;
  delaySeconds: number;
  classification: DelayClassification;
  confidence: FindingConfidence;
  severity: FindingSeverity;
  evidence: {
    currentSpeedKmh: number | null;
    remainingDistanceMeters: number | null;
    etaConfidence: EtaConfidence;
    freshness: 'FRESH' | 'STALE';
  };
  calculatedAt: string;
}

/**
 * Confidence in the FINDING itself (not the position/speed estimate —
 * EtaConfidence already covers that, and reusing it directly would answer
 * a different question). Deliberately independent of EtaConfidence per the
 * approved audit: a stale-but-slow bus can still be an obvious real delay,
 * and a fresh-but-fallback-speed bus can still be a well-evidenced one.
 */
export function deriveFindingConfidence(input: { freshness: 'FRESH' | 'STALE'; etaConfidence: EtaConfidence }): FindingConfidence {
  if (input.freshness === 'STALE') return 'LOW';
  return input.etaConfidence === 'LOW' ? 'MEDIUM' : 'HIGH';
}

/**
 * Reuses the existing severity vocabulary (low/medium/high/critical) — no
 * new vocabulary introduced. `critical` is never assigned here; that tier
 * is reserved for real incident semantics (JOURNEY_INCIDENT), and a delay,
 * however severe, is not an incident.
 */
export function deriveFindingSeverity(classification: DelayClassification, confidence: FindingConfidence): FindingSeverity {
  if (classification === 'SIGNIFICANT_DELAY') return confidence === 'HIGH' ? 'high' : 'medium';
  if (classification === 'MINOR_DELAY') return 'low';
  return 'low';
}

/**
 * Pure function: EtaEstimate -> SafetyFinding | null. A finding is
 * returned ONLY when the underlying ETA classification is
 * SIGNIFICANT_DELAY (rule: never manufacture a finding from missing or
 * invalid data) — MINOR_DELAY/ON_TIME/UNKNOWN all yield null.
 *
 * Known consequence of reusing DeterministicEtaEstimator unmodified: when
 * the underlying location is STALE, EtaService itself refuses to compute a
 * delay/classification at all (`eta.delay` is null) rather than trust a
 * live estimate built on stale data. That means the STALE -> LOW-confidence
 * branch below is real, correct, and independently unit-testable, but is
 * never reachable through the live GET endpoint under current EtaService
 * behavior, since STALE and SIGNIFICANT_DELAY cannot co-occur in a real
 * EtaEstimate. Documented, not worked around — no EtaService behavior was
 * changed to force that combination to occur.
 */
export function computeSafetyFinding(eta: EtaEstimate): SafetyFinding | null {
  if (!eta.tripId) return null;
  if (!eta.delay || eta.delay.classification !== 'SIGNIFICANT_DELAY') return null;

  const freshness: 'FRESH' | 'STALE' = eta.explanation.freshLocation ? 'FRESH' : 'STALE';
  const confidence = deriveFindingConfidence({ freshness, etaConfidence: eta.confidence });
  const severity = deriveFindingSeverity(eta.delay.classification, confidence);

  return {
    findingType: 'SIGNIFICANT_DELAY_RISK',
    busId: eta.busId,
    tripId: eta.tripId,
    routeId: eta.routeId,
    delaySeconds: eta.delay.delaySeconds,
    classification: eta.delay.classification,
    confidence,
    severity,
    evidence: {
      currentSpeedKmh: eta.currentSpeedKmh,
      remainingDistanceMeters: eta.remainingDistanceMeters,
      etaConfidence: eta.confidence,
      freshness,
    },
    calculatedAt: eta.calculatedAt.toISOString(),
  };
}

/** Read service — resolves the trip's current EtaEstimate (EtaService, unchanged) and derives its Finding, if any. Same "trip-scoped, honestly UNKNOWN if telemetry has moved on" behavior as getTripEta itself. */
export function getTripSafetyFinding(tripId: string): SafetyFinding | null {
  return computeSafetyFinding(getTripEta(tripId));
}
