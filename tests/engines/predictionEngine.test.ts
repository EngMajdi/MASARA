import { describe, it, expect } from 'vitest';
import { predictDelay } from '../../server/engines/PredictionEngine';

describe('PredictionEngine', () => {
  it('detects a delay when the current ETA is after the target arrival time', () => {
    const target = new Date('2026-01-01T07:00:00Z');
    const result = predictDelay({
      currentEtaAt: new Date(target.getTime() + 9 * 60_000),
      targetArrivalAt: target,
    });
    expect(result.delayMinutes).toBe(9);
    expect(result.delayProbability).toBeGreaterThan(0.8);
    expect(result.riskLevel).toBe('high');
  });

  it('reports zero delay and low risk when arriving on or before target', () => {
    const target = new Date('2026-01-01T07:00:00Z');
    const result = predictDelay({
      currentEtaAt: new Date(target.getTime() - 2 * 60_000),
      targetArrivalAt: target,
    });
    expect(result.delayMinutes).toBe(0);
    expect(result.riskLevel).toBe('low');
  });

  it('escalates to HIGH risk for a large predicted delay', () => {
    const target = new Date('2026-01-01T07:00:00Z');
    const result = predictDelay({
      currentEtaAt: new Date(target.getTime() + 20 * 60_000),
      targetArrivalAt: target,
    });
    expect(result.riskLevel).toBe('high');
    expect(result.delayProbability).toBeGreaterThanOrEqual(0.9);
  });

  it('open incidents raise probability even before ETA drifts', () => {
    const target = new Date('2026-01-01T07:00:00Z');
    const withIncidents = predictDelay({ currentEtaAt: target, targetArrivalAt: target, openIncidentCount: 2 });
    const withoutIncidents = predictDelay({ currentEtaAt: target, targetArrivalAt: target });
    expect(withIncidents.delayProbability).toBeGreaterThan(withoutIncidents.delayProbability);
  });
});
