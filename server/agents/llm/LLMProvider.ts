import { RiskLevel } from '../../engines/PredictionEngine';
import { StructuredRecommendation } from './recommendationSchema';

export interface RecommendationContext {
  tripId: string;
  problem: string;
  busNumber: string;
  driverName: string;
  delayMinutes: number;
  delayProbability: number;
  riskLevel: RiskLevel;
  alternativeRouteId?: string;
  alternativeRouteName?: string;
  alternativeImprovementMins?: number;
  openIncidentDescriptions: string[];
}

export interface LLMProvider {
  readonly name: string;
  generateRecommendation(context: RecommendationContext): Promise<StructuredRecommendation>;
}
