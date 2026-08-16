import { describe, it, expect } from 'vitest';
import { safeParseStructuredRecommendation } from '../../server/agents/llm/recommendationSchema';
import { MockProvider } from '../../server/agents/llm/MockProvider';
import type { RecommendationContext } from '../../server/agents/llm/LLMProvider';

const provider = new MockProvider();

function baseContext(overrides: Partial<RecommendationContext> = {}): RecommendationContext {
  return {
    tripId: 'trip-1',
    problem: 'Bus 102 running late',
    busNumber: 'Bus 102',
    driverName: 'Driver A',
    delayMinutes: 0,
    delayProbability: 0,
    riskLevel: 'low',
    openIncidentDescriptions: [],
    hasSafetyIncident: false,
    ...overrides,
  };
}

describe('Structured AI recommendation schema', () => {
  it('accepts a valid structured recommendation', () => {
    const valid = {
      type: 'ROUTE_CHANGE',
      title: 'Switch to Route B',
      problem: 'Bus 102 predicted to arrive late',
      severity: 'high',
      confidence: 0.86,
      prediction: { delayMinutes: 9, probability: 0.86 },
      recommendation: {
        action: 'CHANGE_ROUTE',
        targetId: 'route-1',
        reason: 'faster alternative available',
        expectedOutcome: 'Reduce delay by ~7 minutes',
      },
      requiresApproval: true,
    };
    expect(safeParseStructuredRecommendation(valid).success).toBe(true);
  });

  it('rejects malformed AI output (unknown action, missing required fields)', () => {
    const malformed = { problem: 'test', recommendation: { action: 'DELETE_EVERYTHING' } };
    expect(safeParseStructuredRecommendation(malformed).success).toBe(false);
  });

  it('rejects an out-of-range probability', () => {
    const invalid = {
      type: 'MONITORING',
      title: 'x',
      problem: 'test',
      severity: 'high',
      confidence: 0.5,
      prediction: { delayMinutes: 9, probability: 1.5 },
      recommendation: { action: 'NO_ACTION', targetId: null, reason: 'x', expectedOutcome: null },
      requiresApproval: false,
    };
    expect(safeParseStructuredRecommendation(invalid).success).toBe(false);
  });

  it('rejects an unknown recommendation type category', () => {
    const invalid = {
      type: 'BUS_REASSIGNMENT', // not in this system's implemented type set
      title: 'x',
      problem: 'test',
      severity: 'high',
      confidence: 0.5,
      prediction: { delayMinutes: 1, probability: 0.5 },
      recommendation: { action: 'NO_ACTION', targetId: null, reason: 'x', expectedOutcome: null },
      requiresApproval: false,
    };
    expect(safeParseStructuredRecommendation(invalid).success).toBe(false);
  });

  it('MockProvider always produces schema-valid output with zero API keys configured', async () => {
    const rec = await provider.generateRecommendation(
      baseContext({
        delayMinutes: 9,
        delayProbability: 0.86,
        riskLevel: 'high',
        alternativeRouteId: 'route-2',
        alternativeRouteName: 'Route B',
        alternativeImprovementMins: 7,
      })
    );
    expect(safeParseStructuredRecommendation(rec).success).toBe(true);
    expect(rec.recommendation.action).toBe('CHANGE_ROUTE');
    expect(rec.requiresApproval).toBe(true);
  });
});

// Spec Phase 2A §23 — four deterministic mock scenarios, no API key required.
describe('MockProvider deterministic scenarios', () => {
  it('Scenario 1 — traffic (HIGH risk + faster route available) -> CHANGE_ROUTE, approval required', async () => {
    const rec = await provider.generateRecommendation(
      baseContext({
        delayMinutes: 9,
        delayProbability: 0.86,
        riskLevel: 'high',
        alternativeRouteId: 'route-2',
        alternativeRouteName: 'Route B',
        alternativeImprovementMins: 10,
      })
    );
    expect(rec.type).toBe('ROUTE_CHANGE');
    expect(rec.recommendation.action).toBe('CHANGE_ROUTE');
    expect(rec.requiresApproval).toBe(true);
    expect(safeParseStructuredRecommendation(rec).success).toBe(true);
  });

  it('Scenario 2 — minor delay (MEDIUM risk) -> monitor, approval still required', async () => {
    const rec = await provider.generateRecommendation(
      baseContext({ delayMinutes: 4, delayProbability: 0.45, riskLevel: 'medium' })
    );
    expect(rec.type).toBe('MONITORING');
    expect(rec.recommendation.action).not.toBe('NO_ACTION');
    expect(rec.requiresApproval).toBe(true);
  });

  it('Scenario 3 — no issue (LOW risk) -> NO_ACTION, no approval needed', async () => {
    const rec = await provider.generateRecommendation(
      baseContext({ delayMinutes: 0, delayProbability: 0.1, riskLevel: 'low' })
    );
    expect(rec.recommendation.action).toBe('NO_ACTION');
    expect(rec.requiresApproval).toBe(false);
  });

  it('Scenario 4 — safety event (CRITICAL) -> FLAG_INCIDENT, mandatory approval regardless of delay', async () => {
    const rec = await provider.generateRecommendation(
      baseContext({
        delayMinutes: 0,
        delayProbability: 0.05,
        riskLevel: 'critical',
        hasSafetyIncident: true,
        openIncidentDescriptions: ['ACCIDENT reported near school zone'],
      })
    );
    expect(rec.type).toBe('SAFETY_ALERT');
    expect(rec.severity).toBe('critical');
    expect(rec.recommendation.action).toBe('FLAG_INCIDENT');
    expect(rec.requiresApproval).toBe(true);
  });
});
