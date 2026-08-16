import { tripRepository } from '../repositories/tripRepository';
import { busRepository } from '../repositories/busRepository';
import { incidentRepository } from '../repositories/incidentRepository';
import { recommendationRepository } from '../repositories/recommendationRepository';
import { auditRepository } from '../repositories/auditRepository';
import { runForTrip } from '../agents/MasaraOperationsAgent';

// A deterministic orchestration layer around the REAL MASARA domain services
// (spec Phase 2B §20) — it never fakes a result. Every step either calls a
// real repository or the real `runForTrip` agent orchestrator, which itself
// runs PredictionEngine -> LLMProvider(Mock by default) -> PolicyEngine and
// persists a real ai_recommendations row. Approval/execution/verification
// happen exclusively through the existing Approval Center + ActionExecutor —
// this engine never approves anything itself (spec §35/§36).

export type ScenarioId = 'TRAFFIC_DELAY' | 'MINOR_DELAY' | 'NORMAL_TRIP' | 'SAFETY_INCIDENT';
export type SimulationStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export class SimulationNotFoundError extends Error {}
export class InvalidScenarioError extends Error {}
export class SimulationStateError extends Error {}

export interface SimulationSession {
  id: string;
  scenario: ScenarioId;
  status: SimulationStatus;
  tripId: string;
  busId: string;
  createdBy: string;
  startedAt: Date;
  completedAt: Date | null;
  currentStep: number;
  totalSteps: number;
  simulatedTime: Date;
  recommendationId: string | null;
  lastResult: SimulationStepResult | null;
  errorMessage: string | null;
  /** Synchronous re-entrancy guard — closes the await-gap race in advance() (spec §45/§46, AC-19). */
  busyExecuting: boolean;
}

export interface SimulationStepResult {
  stepIndex: number;
  eventType: string;
  label: string;
  simulatedTime: string;
  payload: Record<string, unknown>;
  waitingForApproval: boolean;
}

type StepOutcome = Omit<SimulationStepResult, 'stepIndex' | 'simulatedTime'> & { minutesElapsed: number };
type StepHandler = (session: SimulationSession) => Promise<StepOutcome> | StepOutcome;

const sessions = new Map<string, SimulationSession>();

// ---------------------------------------------------------------------------
// Step handlers — each performs exactly one piece of REAL domain work.
// ---------------------------------------------------------------------------

function stepTripStarted(session: SimulationSession): StepOutcome {
  const trip = tripRepository.findById(session.tripId);
  if (!trip) throw new SimulationStateError('الرحلة المرتبطة بالمحاكاة غير موجودة.');

  // Fresh, deterministic baseline regardless of whatever state this trip was
  // left in by prior demos/approvals — an on-time trip 20 simulated minutes out.
  const targetArrivalAt = new Date(session.simulatedTime.getTime() + 20 * 60_000);
  tripRepository.update(session.tripId, {
    status: 'active',
    startedAt: trip.startedAt ?? session.simulatedTime,
    targetArrivalAt,
    currentEtaAt: targetArrivalAt,
  });

  return {
    eventType: 'TRIP_STARTED',
    label: 'بدأت الرحلة',
    payload: { tripId: session.tripId, busId: session.busId },
    minutesElapsed: 0,
    waitingForApproval: false,
  };
}

function stepBusMoving(session: SimulationSession): StepOutcome {
  const bus = busRepository.findById(session.busId);
  if (!bus) throw new SimulationStateError('الحافلة المرتبطة بالمحاكاة غير موجودة.');

  busRepository.update(session.busId, {
    status: bus.status === 'idle' ? 'en_route_pickup' : bus.status,
    speedKmh: 38,
    currentLat: (bus.currentLat ?? 23.6) + 0.002,
    currentLng: (bus.currentLng ?? 58.4) + 0.002,
  });

  return {
    eventType: 'BUS_MOVING',
    label: 'الحافلة في حركة',
    payload: { busId: session.busId, speedKmh: 38 },
    minutesElapsed: 4,
    waitingForApproval: false,
  };
}

function makeTrafficStep(delayMinutes: number): StepHandler {
  return (session: SimulationSession): StepOutcome => {
    const trip = tripRepository.findById(session.tripId);
    if (!trip) throw new SimulationStateError('الرحلة المرتبطة بالمحاكاة غير موجودة.');

    const targetArrivalAt = trip.targetArrivalAt ?? session.simulatedTime;
    const newEta = new Date(targetArrivalAt.getTime() + delayMinutes * 60_000);
    tripRepository.update(session.tripId, { currentEtaAt: newEta });

    return {
      eventType: 'TRAFFIC_DETECTED',
      label: `ازدحام مروري مكتشف — تأخير تقديري ${delayMinutes} دقيقة`,
      payload: { delayMinutes },
      minutesElapsed: 4,
      waitingForApproval: false,
    };
  };
}

function stepSafetyIncident(session: SimulationSession): StepOutcome {
  incidentRepository.create({
    tripId: session.tripId,
    busId: session.busId,
    type: 'ACCIDENT',
    severity: 'high',
    description: 'حادث بسيط تم الإبلاغ عنه بالقرب من بوابة المدرسة (محاكاة)',
    status: 'open',
  });

  return {
    eventType: 'SAFETY_INCIDENT',
    label: 'حادثة سلامة مُبلَّغ عنها',
    payload: { type: 'ACCIDENT' },
    minutesElapsed: 1,
    waitingForApproval: false,
  };
}

// The real orchestrator: PredictionEngine -> LLMProvider (Mock by default) ->
// PolicyEngine -> persisted recommendation. Reused as-is, never duplicated.
async function stepAiAnalysis(session: SimulationSession): Promise<StepOutcome> {
  const result = await runForTrip(session.tripId);
  session.recommendationId = result.recommendationId;

  const label =
    result.status === 'no_action'
      ? 'تحليل الذكاء الاصطناعي: لا حاجة لأي إجراء'
      : result.status === 'policy_rejected'
        ? 'رفض محرك السياسات التوصية المقترحة'
        : 'تم إنشاء توصية وهي الآن بانتظار قرار المشرف';

  return {
    eventType: 'RECOMMENDATION_CREATED',
    label,
    payload: {
      agentRunId: result.agentRunId,
      predictionId: result.predictionId,
      recommendationId: result.recommendationId,
      status: result.status,
    },
    minutesElapsed: 1,
    waitingForApproval: result.status === 'pending_approval',
  };
}

// Runs after all auto-steps are exhausted: never approves anything itself,
// only reflects whatever the REAL Approval Center has (or hasn't) decided.
function stepAwaitOrResolve(session: SimulationSession): StepOutcome {
  if (!session.recommendationId) {
    return {
      eventType: 'TRIP_COMPLETED',
      label: 'اكتملت المحاكاة — لم يلزم أي إجراء تشغيلي',
      payload: {},
      minutesElapsed: 2,
      waitingForApproval: false,
    };
  }

  const rec = recommendationRepository.findById(session.recommendationId);
  if (!rec) {
    return {
      eventType: 'TRIP_COMPLETED',
      label: 'اكتملت المحاكاة',
      payload: {},
      minutesElapsed: 0,
      waitingForApproval: false,
    };
  }

  if (rec.status === 'pending') {
    return {
      eventType: 'APPROVAL_REQUESTED',
      label: 'بانتظار قرار المشرف في مركز الموافقات',
      payload: { recommendationId: rec.id, status: rec.status },
      minutesElapsed: 0,
      waitingForApproval: true,
    };
  }

  return {
    eventType: rec.status === 'verified' ? 'VERIFICATION_COMPLETED' : rec.status.toUpperCase(),
    label: `اكتملت المحاكاة — حالة التوصية: ${rec.status}`,
    payload: { recommendationId: rec.id, status: rec.status },
    minutesElapsed: 3,
    waitingForApproval: false,
  };
}

const SCENARIO_STEPS: Record<ScenarioId, StepHandler[]> = {
  TRAFFIC_DELAY: [stepTripStarted, stepBusMoving, makeTrafficStep(9), stepAiAnalysis],
  MINOR_DELAY: [stepTripStarted, stepBusMoving, makeTrafficStep(5), stepAiAnalysis],
  NORMAL_TRIP: [stepTripStarted, stepBusMoving, stepAiAnalysis],
  SAFETY_INCIDENT: [stepTripStarted, stepBusMoving, stepSafetyIncident, stepAiAnalysis],
};

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

function logSimulationEvent(session: SimulationSession, eventType: string, label: string, payload: Record<string, unknown>) {
  auditRepository.create({
    eventType,
    actorType: 'system',
    entityType: 'simulation',
    entityId: session.id,
    tripId: session.tripId,
    inputSummary: `[${session.scenario}] ${label}`,
    metadata: JSON.stringify({ scenario: session.scenario, ...payload }),
  });
}

function finalize(session: SimulationSession, outcome: StepOutcome) {
  session.status = 'COMPLETED';
  session.completedAt = new Date();
  logSimulationEvent(session, 'SIMULATION_COMPLETED', outcome.label, outcome.payload);
}

export function startSimulation(scenario: ScenarioId, createdBy: string, requestedTripId?: string): SimulationSession {
  if (!SCENARIO_STEPS[scenario]) {
    throw new InvalidScenarioError(`سيناريو غير معروف: "${scenario}".`);
  }

  const trip = requestedTripId
    ? tripRepository.findById(requestedTripId)
    : tripRepository.findAll().find((t) => t.status === 'active' || t.status === 'scheduled');
  if (!trip) {
    throw new SimulationStateError('لا توجد رحلة مناسبة لتشغيل المحاكاة عليها.');
  }

  const conflicting = Array.from(sessions.values()).find(
    (s) => s.tripId === trip.id && (s.status === 'RUNNING' || s.status === 'PAUSED')
  );
  if (conflicting) {
    throw new SimulationStateError('توجد بالفعل محاكاة نشطة على هذه الرحلة — أكملها أو ألغِها أولاً.');
  }

  const now = new Date();
  const session: SimulationSession = {
    id: crypto.randomUUID(),
    scenario,
    status: 'RUNNING',
    tripId: trip.id,
    busId: trip.busId,
    createdBy,
    startedAt: now,
    completedAt: null,
    currentStep: 0,
    totalSteps: SCENARIO_STEPS[scenario].length,
    simulatedTime: now,
    recommendationId: null,
    lastResult: null,
    errorMessage: null,
    busyExecuting: false,
  };
  sessions.set(session.id, session);

  logSimulationEvent(session, 'SIMULATION_STARTED', `بدأت محاكاة: ${scenario}`, { scenario, tripId: trip.id });

  return session;
}

export function getSession(id: string): SimulationSession {
  const session = sessions.get(id);
  if (!session) throw new SimulationNotFoundError('جلسة المحاكاة غير موجودة.');
  return session;
}

export function listSessions(): SimulationSession[] {
  return Array.from(sessions.values()).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}

export async function advanceSimulation(id: string): Promise<SimulationStepResult> {
  const session = getSession(id);

  if (session.status === 'PAUSED') throw new SimulationStateError('المحاكاة متوقفة مؤقتاً — استأنفها أولاً.');
  if (session.status !== 'RUNNING') throw new SimulationStateError(`لا يمكن متابعة محاكاة بحالة "${session.status}".`);
  if (session.busyExecuting) throw new SimulationStateError('خطوة أخرى قيد التنفيذ بالفعل لهذه الجلسة — انتظر انتهاءها.');

  const steps = SCENARIO_STEPS[session.scenario];
  session.busyExecuting = true;

  try {
    let outcome: StepOutcome;
    let stepIndex: number;

    if (session.currentStep < steps.length) {
      stepIndex = session.currentStep;
      const isLastAutoStep = stepIndex === steps.length - 1; // always the AI_ANALYSIS step
      outcome = await steps[stepIndex](session);
      session.currentStep += 1;

      // AI_ANALYSIS already wrote its own real audit rows via runForTrip —
      // logging it again here would duplicate the event, not just label it.
      // For the rest, use the step's real event type (TRIP_STARTED,
      // BUS_MOVING, TRAFFIC_DETECTED, SAFETY_INCIDENT) directly — these are
      // part of MASARA's existing event vocabulary (spec §13), not a
      // generic wrapper, so the Operations Feed can filter/categorize them
      // without parsing metadata.
      if (!isLastAutoStep) {
        logSimulationEvent(session, outcome.eventType, outcome.label, outcome.payload);
      }

      if (isLastAutoStep && !outcome.waitingForApproval) {
        finalize(session, outcome);
      }
    } else {
      stepIndex = steps.length;
      outcome = await stepAwaitOrResolve(session);
      if (!outcome.waitingForApproval) {
        finalize(session, outcome);
      }
    }

    session.simulatedTime = new Date(session.simulatedTime.getTime() + outcome.minutesElapsed * 60_000);
    const result: SimulationStepResult = {
      stepIndex,
      eventType: outcome.eventType,
      label: outcome.label,
      simulatedTime: session.simulatedTime.toISOString(),
      payload: outcome.payload,
      waitingForApproval: outcome.waitingForApproval,
    };
    session.lastResult = result;
    return result;
  } catch (err) {
    session.status = 'FAILED';
    session.completedAt = new Date();
    session.errorMessage = (err as Error).message;
    logSimulationEvent(session, 'SIMULATION_FAILED', (err as Error).message, {});
    throw err;
  } finally {
    session.busyExecuting = false;
  }
}

export function pauseSimulation(id: string): SimulationSession {
  const session = getSession(id);
  if (session.status !== 'RUNNING') {
    throw new SimulationStateError(`لا يمكن إيقاف محاكاة مؤقتاً بحالة "${session.status}".`);
  }
  session.status = 'PAUSED';
  return session;
}

export function resumeSimulation(id: string): SimulationSession {
  const session = getSession(id);
  if (session.status !== 'PAUSED') {
    throw new SimulationStateError(`لا يمكن استئناف محاكاة بحالة "${session.status}".`);
  }
  session.status = 'RUNNING';
  return session;
}

export function cancelSimulation(id: string): SimulationSession {
  const session = getSession(id);
  if (session.status === 'COMPLETED' || session.status === 'FAILED' || session.status === 'CANCELLED') {
    throw new SimulationStateError(`لا يمكن إلغاء محاكاة بحالة "${session.status}" (منتهية بالفعل).`);
  }
  session.status = 'CANCELLED';
  session.completedAt = new Date();
  logSimulationEvent(session, 'SIMULATION_CANCELLED', 'أُلغيت المحاكاة يدوياً', {});
  return session;
}

/** Lists this session's real audit trail (lifecycle + operational events), scoped to its time window. Never deletes anything. */
export function listSessionEvents(id: string) {
  const session = getSession(id);
  // SQLite integer timestamp columns round to second precision on read, but
  // `session.startedAt` keeps full millisecond precision in memory — without
  // slack, a row logged in the same second as session start can appear to
  // predate it and get filtered out. A 1s buffer absorbs that rounding.
  const cutoff = session.startedAt.getTime() - 1000;
  return auditRepository.findByTripId(session.tripId).filter((e) => e.createdAt.getTime() >= cutoff);
}

/** Clears in-memory session bookkeeping only — never touches audit_logs or any persisted domain data (spec §40/AC-20). */
export function resetAllSimulations(): void {
  sessions.clear();
}
