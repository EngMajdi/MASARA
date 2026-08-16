import { describe, it, expect } from 'vitest';
import { safeParseStructuredRecommendation } from '../../server/agents/llm/recommendationSchema';
import { MockProvider } from '../../server/agents/llm/MockProvider';

describe('Structured AI recommendation schema', () => {
  it('accepts a valid structured recommendation', () => {
    const valid = {
      problem: 'Bus 102 predicted to arrive late',
      severity: 'high',
      prediction: { delayMinutes: 9, probability: 0.86 },
      recommendation: { action: 'CHANGE_ROUTE', targetId: 'route-1', reason: 'faster alternative available' },
      requiresApproval: true,
    };
    expect(safeParseStructuredRecommendation(valid).success).toBe(true);
  });

  it('rejects malformed AI output (unknown action, missing fields)', () => {
    const malformed = { problem: 'test', recommendation: { action: 'DELETE_EVERYTHING' } };
    expect(safeParseStructuredRecommendation(malformed).success).toBe(false);
  });

  it('rejects an out-of-range probability', () => {
    const invalid = {
      problem: 'test',
      severity: 'high',
      prediction: { delayMinutes: 9, probability: 1.5 },
      recommendation: { action: 'NO_ACTION', targetId: null, reason: 'x' },
      requiresApproval: false,
    };
    expect(safeParseStructuredRecommendation(invalid).success).toBe(false);
  });

  it('MockProvider always produces schema-valid output with zero API keys configured', async () => {
    const provider = new MockProvider();
    const rec = await provider.generateRecommendation({
      tripId: 'trip-1',
      problem: 'Bus 102 running late',
      busNumber: 'Bus 102',
      driverName: 'Driver A',
      delayMinutes: 9,
      delayProbability: 0.86,
      riskLevel: 'high',
      alternativeRouteId: 'route-2',
      alternativeRouteName: 'Route B',
      alternativeImprovementMins: 7,
      openIncidentDescriptions: [],
    });
    expect(safeParseStructuredRecommendation(rec).success).toBe(true);
    expect(rec.recommendation.action).toBe('CHANGE_ROUTE');
    expect(rec.requiresApproval).toBe(true);
  });

  it('MockProvider recommends NO_ACTION (no approval required) when risk is low', async () => {
    const provider = new MockProvider();
    const rec = await provider.generateRecommendation({
      tripId: 'trip-2',
      problem: 'On schedule',
      busNumber: 'Bus 101',
      driverName: 'Driver B',
      delayMinutes: 0,
      delayProbability: 0.1,
      riskLevel: 'low',
      openIncidentDescriptions: [],
    });
    expect(rec.recommendation.action).toBe('NO_ACTION');
    expect(rec.requiresApproval).toBe(false);
  });
});
