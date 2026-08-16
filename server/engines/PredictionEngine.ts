// Deterministic delay/risk calculator. This is the single source of truth for
// ETA, delay, probability, and risk numbers in MASARA — an LLM may explain
// these results, but it never computes them (spec §9, §29).

export type RiskLevel = 'low' | 'medium' | 'high';

// PredictionEngine's own ETA math only ever produces low/medium/high — it has
// no concept of a safety incident. 'critical' is an escalation applied one
// layer up (MasaraOperationsAgent, from open ACCIDENT/BREAKDOWN incidents),
// so the wider vocabulary lives here as a distinct type rather than being
// silently folded into RiskLevel's own domain.
export type EffectiveRiskLevel = RiskLevel | 'critical';

export interface PredictionInput {
  currentEtaAt: Date;
  targetArrivalAt: Date;
  /** Open incidents on the trip nudge risk upward even before ETA drifts. */
  openIncidentCount?: number;
}

export interface PredictionResult {
  delayMinutes: number;
  delayProbability: number;
  riskLevel: RiskLevel;
}

export function predictDelay(input: PredictionInput): PredictionResult {
  const delayMs = input.currentEtaAt.getTime() - input.targetArrivalAt.getTime();
  const delayMinutes = Math.max(0, Math.round(delayMs / 60_000));

  const incidentBoost = Math.min(0.25, (input.openIncidentCount ?? 0) * 0.12);
  const probability =
    delayMinutes === 0
      ? Math.min(0.35, incidentBoost)
      : Math.min(0.98, 0.15 + delayMinutes * 0.079 + incidentBoost);

  const riskLevel: RiskLevel =
    delayMinutes >= 8 || probability >= 0.75
      ? 'high'
      : delayMinutes >= 3 || probability >= 0.4
        ? 'medium'
        : 'low';

  return {
    delayMinutes,
    delayProbability: Number(probability.toFixed(2)),
    riskLevel,
  };
}
