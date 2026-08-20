import { describe, it, expect, beforeEach } from 'vitest';
import {
  startSimulation,
  advanceSimulation,
  pauseSimulation,
  resumeSimulation,
  cancelSimulation,
  getSession,
  listSessionEvents,
  resetAllSimulations,
  SimulationStateError,
  InvalidScenarioError,
} from '../../server/services/SimulationEngine';
import { approveRecommendation } from '../../server/services/ActionExecutor';
import { recommendationRepository } from '../../server/repositories/recommendationRepository';
import { incidentRepository } from '../../server/repositories/incidentRepository';
import { tripRepository } from '../../server/repositories/tripRepository';
import { routeRepository } from '../../server/repositories/routeRepository';
import { busRepository } from '../../server/repositories/busRepository';
import { userRepository } from '../../server/repositories/userRepository';
import { auditRepository } from '../../server/repositories/auditRepository';

function findAdmin() {
  return userRepository.findAll().find((u) => u.role === 'admin')!;
}

// The SAFETY_INCIDENT test leaves a real open incident behind on whichever
// trip it used — skip any trip with an open incident so later tests don't
// inherit an unintended CRITICAL escalation.
function freshTrip() {
  const trips = tripRepository.findAll();
  return trips.find((t) => incidentRepository.findOpenByTripId(t.id).length === 0) ?? trips[0];
}

// TRAFFIC_DELAY only yields CHANGE_ROUTE when a genuinely faster same-school
// route exists — pick a trip where that's true, rather than assuming seed order.
function tripWithFasterAlternative() {
  const trips = tripRepository.findAll().filter((t) => incidentRepository.findOpenByTripId(t.id).length === 0);
  for (const trip of trips) {
    const bus = busRepository.findById(trip.busId)!;
    const currentRoute = routeRepository.findById(trip.routeId)!;
    const hasFaster = routeRepository
      .findBySchoolId(bus.schoolId)
      .some((r) => r.id !== currentRoute.id && r.estimatedDurationMins < currentRoute.estimatedDurationMins);
    if (hasFaster) return trip;
  }
  throw new Error('No trip with a faster alternative route found in seed data.');
}

describe('SimulationEngine — real domain services, no fake results (spec Phase 2B §20, AC-06..11)', () => {
  beforeEach(() => {
    resetAllSimulations();
  });

  it('TRAFFIC_DELAY: runs TRIP_STARTED -> BUS_MOVING -> TRAFFIC_DETECTED -> AI_ANALYSIS and produces a real HIGH-risk CHANGE_ROUTE recommendation awaiting approval', async () => {
    const trip = tripWithFasterAlternative();
    const session = startSimulation('TRAFFIC_DELAY', 'system-test', trip.id);
    expect(session.status).toBe('RUNNING');
    expect(session.totalSteps).toBe(4);

    const r1 = await advanceSimulation(session.id); // TRIP_STARTED
    expect(r1.eventType).toBe('TRIP_STARTED');
    const r2 = await advanceSimulation(session.id); // BUS_MOVING
    expect(r2.eventType).toBe('BUS_MOVING');
    const r3 = await advanceSimulation(session.id); // TRAFFIC_DETECTED
    expect(r3.eventType).toBe('TRAFFIC_DETECTED');
    const r4 = await advanceSimulation(session.id); // AI_ANALYSIS — real runForTrip call
    expect(r4.eventType).toBe('RECOMMENDATION_CREATED');
    expect(r4.waitingForApproval).toBe(true);

    const updated = getSession(session.id);
    expect(updated.status).toBe('RUNNING'); // still waiting, not auto-completed
    expect(updated.recommendationId).toBeTruthy();

    const rec = recommendationRepository.findById(updated.recommendationId!)!;
    expect(rec.severity).toBe('high');
    expect(rec.action).toBe('CHANGE_ROUTE');
    expect(rec.status).toBe('pending'); // never auto-approved (spec §36, AC-18-style guarantee for HIGH too)
  });

  it('the simulation never approves anything itself — only the real Approval Center flow resolves it', async () => {
    const trip = tripWithFasterAlternative();
    const session = startSimulation('TRAFFIC_DELAY', 'system-test', trip.id);
    for (let i = 0; i < 4; i++) await advanceSimulation(session.id);

    const before = getSession(session.id);
    expect(before.status).toBe('RUNNING');

    // Approve through the REAL ActionExecutor — the only sanctioned path.
    const admin = findAdmin();
    await approveRecommendation(before.recommendationId!, admin.id);

    const resolveResult = await advanceSimulation(session.id); // now resolves + finalizes
    expect(resolveResult.waitingForApproval).toBe(false);

    const after = getSession(session.id);
    expect(after.status).toBe('COMPLETED');
  });

  it('MINOR_DELAY: produces a MEDIUM-risk recommendation that still requires approval (never auto-monitored silently)', async () => {
    const trip = freshTrip();
    const session = startSimulation('MINOR_DELAY', 'system-test', trip.id);
    for (let i = 0; i < 3; i++) await advanceSimulation(session.id);
    const result = await advanceSimulation(session.id);

    expect(result.waitingForApproval).toBe(true);
    const rec = recommendationRepository.findById(getSession(session.id).recommendationId!)!;
    expect(rec.severity).toBe('medium');
    expect(rec.requiresApproval).toBe(true);
    expect(rec.action).not.toBe('NO_ACTION');
  });

  it('NORMAL_TRIP: no meaningful delay -> no recommendation, session completes automatically with no operational mutation', async () => {
    const trip = freshTrip();
    const session = startSimulation('NORMAL_TRIP', 'system-test', trip.id);
    expect(session.totalSteps).toBe(3);

    await advanceSimulation(session.id); // TRIP_STARTED
    await advanceSimulation(session.id); // BUS_MOVING
    const result = await advanceSimulation(session.id); // AI_ANALYSIS -> no_action

    expect(result.waitingForApproval).toBe(false);
    const after = getSession(session.id);
    expect(after.status).toBe('COMPLETED');
    expect(after.recommendationId).toBeNull();
  });

  it('SAFETY_INCIDENT: forces CRITICAL severity via the real PolicyEngine/Agent escalation rule (not duplicated here) and still requires approval', async () => {
    const trip = freshTrip();
    const session = startSimulation('SAFETY_INCIDENT', 'system-test', trip.id);
    await advanceSimulation(session.id); // TRIP_STARTED
    await advanceSimulation(session.id); // BUS_MOVING
    const incidentStep = await advanceSimulation(session.id); // SAFETY_INCIDENT
    expect(incidentStep.eventType).toBe('SAFETY_INCIDENT');
    expect(incidentRepository.findOpenByTripId(trip.id).length).toBeGreaterThan(0);

    const result = await advanceSimulation(session.id); // AI_ANALYSIS
    expect(result.waitingForApproval).toBe(true);

    const rec = recommendationRepository.findById(getSession(session.id).recommendationId!)!;
    expect(rec.severity).toBe('critical');
    expect(rec.action).toBe('FLAG_INCIDENT');
    expect(rec.status).toBe('pending'); // CRITICAL never auto-executes (spec §36/§38, AC-18)
  });

  it('rejects an unknown scenario', () => {
    expect(() => startSimulation('NOT_A_SCENARIO' as any, 'system-test')).toThrow(InvalidScenarioError);
  });

  it('prevents a second simulation from starting on a trip that already has one running (spec §45)', () => {
    const trip = freshTrip();
    startSimulation('NORMAL_TRIP', 'system-test', trip.id);
    expect(() => startSimulation('TRAFFIC_DELAY', 'system-test', trip.id)).toThrow(SimulationStateError);
  });

  it('rejects concurrent advance() calls on the same session — only one step executes (spec §46, AC-19)', async () => {
    const trip = freshTrip();
    const session = startSimulation('NORMAL_TRIP', 'system-test', trip.id);

    const [a, b] = await Promise.allSettled([advanceSimulation(session.id), advanceSimulation(session.id)]);
    const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
    const rejected = [a, b].filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(getSession(session.id).currentStep).toBe(1); // exactly one step consumed, not two
  });

  it('pause -> resume works; advancing while paused is rejected', async () => {
    const trip = freshTrip();
    const session = startSimulation('NORMAL_TRIP', 'system-test', trip.id);
    const paused = pauseSimulation(session.id);
    expect(paused.status).toBe('PAUSED');

    await expect(advanceSimulation(session.id)).rejects.toThrow(SimulationStateError);

    const resumed = resumeSimulation(session.id);
    expect(resumed.status).toBe('RUNNING');
  });

  it('cannot advance a completed/cancelled session (invalid state transition)', async () => {
    const trip = freshTrip();
    const session = startSimulation('NORMAL_TRIP', 'system-test', trip.id);
    cancelSimulation(session.id);
    await expect(advanceSimulation(session.id)).rejects.toThrow(SimulationStateError);
  });

  it('cannot cancel an already-terminal session', async () => {
    const trip = freshTrip();
    const session = startSimulation('NORMAL_TRIP', 'system-test', trip.id);
    for (let i = 0; i < 3; i++) await advanceSimulation(session.id);
    expect(getSession(session.id).status).toBe('COMPLETED');
    expect(() => cancelSimulation(session.id)).toThrow(SimulationStateError);
  });

  it('listSessionEvents returns real audit rows, including the simulation lifecycle markers', async () => {
    const trip = freshTrip();
    const session = startSimulation('NORMAL_TRIP', 'system-test', trip.id);
    await advanceSimulation(session.id);

    const events = listSessionEvents(session.id);
    const eventTypes = events.map((e) => e.eventType);
    expect(eventTypes).toContain('SIMULATION_STARTED');
    expect(eventTypes).toContain('TRIP_STARTED');
  });

  it('resetAllSimulations clears in-memory sessions but never touches audit_logs (spec §40, AC-20)', async () => {
    const trip = freshTrip();
    const session = startSimulation('NORMAL_TRIP', 'system-test', trip.id);
    await advanceSimulation(session.id);

    const auditCountBefore = auditRepository.findAll().length;
    resetAllSimulations();
    const auditCountAfter = auditRepository.findAll().length;

    expect(auditCountAfter).toBe(auditCountBefore); // untouched
    expect(() => getSession(session.id)).toThrow(); // but the in-memory session is gone
  });
});
