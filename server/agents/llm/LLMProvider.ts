import { EffectiveRiskLevel } from '../../engines/PredictionEngine';
import { StructuredRecommendation } from './recommendationSchema';

export interface RecommendationContext {
  tripId: string;
  problem: string;
  busNumber: string;
  driverName: string;
  delayMinutes: number;
  delayProbability: number;
  /** 'critical' is applied by the Agent from open safety incidents, not by PredictionEngine's ETA math. */
  riskLevel: EffectiveRiskLevel;
  alternativeRouteId?: string;
  alternativeRouteName?: string;
  alternativeImprovementMins?: number;
  openIncidentDescriptions: string[];
  hasSafetyIncident: boolean;
}

export interface LLMProvider {
  readonly name: string;
  generateRecommendation(context: RecommendationContext): Promise<StructuredRecommendation>;
}
