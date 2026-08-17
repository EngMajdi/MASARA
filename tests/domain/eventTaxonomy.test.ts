import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  deriveEventCategory,
  deriveEventSource,
  OPERATIONAL_EVENT_TYPES,
  INTELLIGENCE_EVENT_TYPES,
  GOVERNANCE_EVENT_TYPES,
  TELEMETRY_EVENT_TYPES,
} from '../../server/domain/eventTaxonomy';
import { auditRepository } from '../../server/repositories/auditRepository';
import { tripRepository } from '../../server/repositories/tripRepository';
import { studentRepository } from '../../server/repositories/studentRepository';
import { driverRepository } from '../../server/repositories/driverRepository';
import { userRepository } from '../../server/repositories/userRepository';
import { startSimulation, advanceSimulation, listSessionEvents } from '../../server/services/SimulationEngine';
import { createJourney, startJourney } from '../../server/services/JourneyService';

describe('deriveEventCategory (spec Phase 3C §7/§36) — every real event type currently in use', () => {
  it('classifies every real OPERATIONAL event type', () => {
    for (const t of OPERATIONAL_EVENT_TYPES) {
      expect(deriveEventCategory(t)).toBe('OPERATIONAL');
    }
  });

  it('classifies every real INTELLIGENCE event type', () => {
    for (const t of INTELLIGENCE_EVENT_TYPES) {
      expect(deriveEventCategory(t)).toBe('INTELLIGENCE');
    }
  });

  it('classifies every real GOVERNANCE event type', () => {
    for (const t of GOVERNANCE_EVENT_TYPES) {
      expect(deriveEventCategory(t)).toBe('GOVERNANCE');
    }
  });

  it('classifies reserved (not-yet-produced) TELEMETRY event types correctly, proving the contract is ready before Phase 4 exists', () => {
    for (const t of TELEMETRY_EVENT_TYPES) {
      expect(deriveEventCategory(t)).toBe('TELEMETRY');
    }
  });

  it('spot-checks specific real event types against their actual domain meaning', () => {
    expect(deriveEventCategory('JOURNEY_CREATED')).toBe('OPERATIONAL');
    expect(deriveEventCategory('STUDENT_BOARDED')).toBe('OPERATIONAL');
    expect(deriveEventCategory('SAFETY_INCIDENT')).toBe('OPERATIONAL');
    expect(deriveEventCategory('RECOMMENDATION_CREATED')).toBe('INTELLIGENCE');
    expect(deriveEventCategory('TRAFFIC_DETECTED')).toBe('INTELLIGENCE');
    expect(deriveEventCategory('APPROVED')).toBe('GOVERNANCE');
    expect(deriveEventCategory('GPS_LOCATION_RECEIVED')).toBe('TELEMETRY');
  });

  it('never silently classifies an unknown event type as TELEMETRY (spec §7/§36 explicit warning) — falls back to UNKNOWN', () => {
    expect(deriveEventCategory('SOME_FUTURE_EVENT_NOBODY_HAS_DEFINED_YET')).toBe('UNKNOWN');
    expect(deriveEventCategory('')).toBe('UNKNOWN');
  });

  it('OPERATIONAL/INTELLIGENCE/GOVERNANCE/TELEMETRY registries never share an event type (each real event has exactly one category)', () => {
    const all = [...OPERATIONAL_EVENT_TYPES, ...INTELLIGENCE_EVENT_TYPES, ...GOVERNANCE_EVENT_TYPES, ...TELEMETRY_EVENT_TYPES];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('deriveEventSource (spec Phase 3C §9/§33/§34) — derived from existing actor/entity fields only', () => {
  it('maps each known actorType to its source', () => {
    expect(deriveEventSource({ actorType: 'driver' })).toBe('DRIVER');
    expect(deriveEventSource({ actorType: 'school' })).toBe('SCHOOL');
    expect(deriveEventSource({ actorType: 'admin' })).toBe('ADMIN');
    expect(deriveEventSource({ actorType: 'agent' })).toBe('AI_AGENT');
    expect(deriveEventSource({ actorType: 'user' })).toBe('APPROVAL_CENTER');
    expect(deriveEventSource({ actorType: 'system' })).toBe('SYSTEM');
  });

  it('falls back to SYSTEM for an unrecognized actorType rather than throwing', () => {
    expect(deriveEventSource({ actorType: 'something-unexpected' })).toBe('SYSTEM');
  });

  it('entityType === "simulation" always wins, regardless of actorType (spec §33/§34 — never confuse simulation with a real actor)', () => {
    expect(deriveEventSource({ actorType: 'system', entityType: 'simulation' })).toBe('SIMULATION');
    expect(deriveEventSource({ actorType: 'driver', entityType: 'simulation' })).toBe('SIMULATION');
  });
});

describe('Simulation events remain identifiable as SIMULATION in real audit data (spec §33/§34, mandatory test #6)', () => {
  it('every real audit row produced by a running simulation derives source = SIMULATION, never SYSTEM', async () => {
    const trip = tripRepository.findAll().find((t) => t.status === 'active')!;
    const session = startSimulation('NORMAL_TRIP', 'admin@masara.om', trip.id);
    await advanceSimulation(session.id); // stepTripStarted -> logs TRIP_STARTED

    const events = listSessionEvents(session.id);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(deriveEventSource({ actorType: e.actorType, entityType: e.entityType })).toBe('SIMULATION');
    }
  });
});

describe('Real Journey (driver-caused) events derive source = DRIVER, distinguishing them from SIMULATION (spec §34)', () => {
  it('a Journey transition performed by a real driver actor derives DRIVER, not SYSTEM or SIMULATION', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const driver = driverRepository.findById(trip.driverId!)!;
    const driverUser = userRepository.findById(driver.userId!)!;
    const student = studentRepository.findByBusId(trip.busId)[0];

    const journey = createJourney(student.id, trip.id, { actorId: driverUser.id, actorType: 'driver' });
    startJourney(journey.id, { actorId: driverUser.id, actorType: 'driver' });

    const events = auditRepository.findByEntity('journey', journey.id);
    const startedEvent = events.find((e) => e.eventType === 'JOURNEY_STARTED')!;
    expect(startedEvent).toBeTruthy();
    expect(deriveEventSource({ actorType: startedEvent.actorType, entityType: startedEvent.entityType })).toBe('DRIVER');
    expect(deriveEventCategory(startedEvent.eventType)).toBe('OPERATIONAL');
  });
});

describe('No generic event injection endpoint exists (spec §29/§30/§63 mandatory test #8)', () => {
  const journeyRoutesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/journeyRoutes.ts'), 'utf8');
  const agentRoutesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/agentRoutes.ts'), 'utf8');
  const operationsRoutesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/operationsRoutes.ts'), 'utf8');
  const simulationRoutesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/simulationRoutes.ts'), 'utf8');
  const allRouteSource = journeyRoutesSource + agentRoutesSource + operationsRoutesSource + simulationRoutesSource;

  it('no route accepts a generic client-submitted eventType', () => {
    expect(allRouteSource).not.toMatch(/req\.body\??\.eventType/);
    expect(allRouteSource).not.toMatch(/req\.body\??\.eventCategory/);
  });

  it('no POST /api/events, /api/telemetry, or /api/gps endpoint exists anywhere', () => {
    expect(allRouteSource).not.toMatch(/['"]\/api\/events['"]/);
    expect(allRouteSource).not.toMatch(/['"]\/api\/telemetry['"]/);
    expect(allRouteSource).not.toMatch(/['"]\/api\/gps['"]/);
    expect(allRouteSource).not.toMatch(/['"]\/api\/location['"]/);
  });

  it('no generic Journey state-setter endpoint exists (still true after Phase 3C)', () => {
    expect(journeyRoutesSource).not.toMatch(/\/api\/journeys\/:id\/(state|transition)['"]/);
  });
});
