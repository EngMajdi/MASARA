import { tripRepository } from '../repositories/tripRepository';
import { busRepository } from '../repositories/busRepository';
import { driverRepository } from '../repositories/driverRepository';
import { routeRepository } from '../repositories/routeRepository';
import { incidentRepository } from '../repositories/incidentRepository';
import { predictionRepository } from '../repositories/predictionRepository';
import { recommendationRepository } from '../repositories/recommendationRepository';
import { auditRepository } from '../repositories/auditRepository';
import { predictDelay } from '../engines/PredictionEngine';
import { getLLMProvider } from './llm';
import { safeParseStructuredRecommendation } from './llm/recommendationSchema';
import { evaluateRecommendation } from '../services/PolicyEngine';

export type AgentRunStatus = 'pending_approval' | 'no_action' | 'policy_rejected';

export interface AgentRunResult {
  agentRunId: string;
  predictionId: string;
  recommendationId: string | null;
  status: AgentRunStatus;
  reason?: string;
}

// Orchestrates one full pass of the MASARA intelligence loop for a single trip:
// inspect -> detect -> predict -> request route options -> recommend -> explain
// -> (persist as pending, wait for a human) -> log. It never mutates trip/route
// state itself — that only happens later, in ActionExecutor, after approval.
export async function runForTrip(tripId: string): Promise<AgentRunResult> {
  const agentRunId = crypto.randomUUID();

  const trip = tripRepository.findById(tripId);
  if (!trip) throw new Error('الرحلة غير موجودة.');
  if (!trip.currentEtaAt || !trip.targetArrivalAt) {
    throw new Error('لا تتوفر بيانات وقت وصول كافية لتحليل هذه الرحلة.');
  }

  const bus = busRepository.findById(trip.busId);
  if (!bus) throw new Error('الحافلة غير موجودة.');
  const driver = trip.driverId ? driverRepository.findById(trip.driverId) : undefined;
  const openIncidents = incidentRepository.findOpenByTripId(tripId);

  // 1. Predict — deterministic, not LLM-derived.
  const prediction = predictDelay({
    currentEtaAt: trip.currentEtaAt,
    targetArrivalAt: trip.targetArrivalAt,
    openIncidentCount: openIncidents.length,
  });

  const predictionRow = predictionRepository.create({
    tripId,
    currentEtaAt: trip.currentEtaAt,
    targetArrivalAt: trip.targetArrivalAt,
    delayMinutes: prediction.delayMinutes,
    delayProbability: prediction.delayProbability,
    riskLevel: prediction.riskLevel,
    createdBy: agentRunId,
  });

  // 2. Route options — pick the fastest alternative route in the same school, if any.
  const currentRoute = routeRepository.findById(trip.routeId);
  const alternative = currentRoute
    ? routeRepository
        .findBySchoolId(bus.schoolId)
        .filter((r) => r.id !== currentRoute.id)
        .map((r) => ({ route: r, improvement: currentRoute.estimatedDurationMins - r.estimatedDurationMins }))
        .filter((r) => r.improvement > 0)
        .sort((a, b) => b.improvement - a.improvement)[0]
    : undefined;

  const problem =
    prediction.delayMinutes > 0
      ? `الحافلة ${bus.busNumber} متوقع وصولها متأخرة ${prediction.delayMinutes} دقيقة عن الوقت المستهدف.`
      : openIncidents.length > 0
        ? `توجد ${openIncidents.length} حادثة مفتوحة على رحلة الحافلة ${bus.busNumber}.`
        : `رحلة الحافلة ${bus.busNumber} ضمن الوقت المستهدف.`;

  // 3. Recommend + explain (LLM — mock by default, Gemini if AI_MODE=gemini).
  const llmProvider = getLLMProvider();
  const rawRecommendation = await llmProvider.generateRecommendation({
    tripId,
    problem,
    busNumber: bus.busNumber,
    driverName: driver?.name ?? 'غير محدد',
    delayMinutes: prediction.delayMinutes,
    delayProbability: prediction.delayProbability,
    riskLevel: prediction.riskLevel,
    alternativeRouteId: alternative?.route.id,
    alternativeRouteName: alternative?.route.name,
    alternativeImprovementMins: alternative?.improvement,
    openIncidentDescriptions: openIncidents.map((i) => i.description),
  });

  // 4. Validate structure — malformed AI output never reaches application logic.
  const parsed = safeParseStructuredRecommendation(rawRecommendation);
  if (!parsed.success) {
    auditRepository.create({
      agentRunId,
      inputSummary: `Agent run for trip ${tripId}`,
      detectedProblem: problem,
      predictionId: predictionRow.id,
      operatorDecision: null,
    });
    throw new Error(`مخرجات الذكاء الاصطناعي غير صالحة ولم تجتز التحقق من المخطط: ${parsed.error.message}`);
  }
  const structured = parsed.data;

  if (structured.recommendation.action === 'NO_ACTION') {
    auditRepository.create({
      agentRunId,
      inputSummary: `Agent run for trip ${tripId}`,
      detectedProblem: structured.problem,
      predictionId: predictionRow.id,
      operatorDecision: 'no_action',
    });
    return { agentRunId, predictionId: predictionRow.id, recommendationId: null, status: 'no_action' };
  }

  // 5. Policy check — decides whether this is even allowed to reach a human.
  const policyResult = evaluateRecommendation(
    {
      action: structured.recommendation.action,
      targetId: structured.recommendation.targetId,
      requiresApproval: structured.requiresApproval,
    },
    tripId
  );

  if (!policyResult.allowed) {
    const rejectedRow = recommendationRepository.create({
      tripId,
      agentRunId,
      severity: structured.severity,
      problem: structured.problem,
      predictionId: predictionRow.id,
      action: structured.recommendation.action,
      targetId: structured.recommendation.targetId,
      reason: structured.recommendation.reason,
      requiresApproval: structured.requiresApproval,
      status: 'rejected',
      decidedAt: new Date(),
      rejectionReason: `PolicyEngine: ${policyResult.reason}`,
    });

    auditRepository.create({
      agentRunId,
      inputSummary: `Agent run for trip ${tripId}`,
      detectedProblem: structured.problem,
      predictionId: predictionRow.id,
      recommendationId: rejectedRow.id,
      operatorDecision: 'policy_rejected',
    });

    return {
      agentRunId,
      predictionId: predictionRow.id,
      recommendationId: rejectedRow.id,
      status: 'policy_rejected',
      reason: policyResult.reason,
    };
  }

  // 6. Persist as pending — the agent stops here and waits for a human.
  const recommendationRow = recommendationRepository.create({
    tripId,
    agentRunId,
    severity: structured.severity,
    problem: structured.problem,
    predictionId: predictionRow.id,
    action: structured.recommendation.action,
    targetId: structured.recommendation.targetId,
    reason: structured.recommendation.reason,
    requiresApproval: structured.requiresApproval,
    status: 'pending',
  });

  auditRepository.create({
    agentRunId,
    inputSummary: `Agent run for trip ${tripId}`,
    detectedProblem: structured.problem,
    predictionId: predictionRow.id,
    recommendationId: recommendationRow.id,
    operatorDecision: null,
  });

  return {
    agentRunId,
    predictionId: predictionRow.id,
    recommendationId: recommendationRow.id,
    status: 'pending_approval',
  };
}

export const MasaraOperationsAgent = { runForTrip };
