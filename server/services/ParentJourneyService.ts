import { resolveAuthorizedStudents } from './ParentAccessService';
import { journeyRepository } from '../repositories/journeyRepository';
import { tripRepository } from '../repositories/tripRepository';
import { busRepository } from '../repositories/busRepository';
import { routeRepository } from '../repositories/routeRepository';
import { driverRepository } from '../repositories/driverRepository';
import { auditRepository } from '../repositories/auditRepository';
import { getCurrentLocation } from './CurrentLocationProjectionService';
import { getTripEta } from './EtaService';
import { JOURNEY_ACTIVE_STATES, PARENT_SAFE_EVENT_TYPES, type ParentJourneyEventView, type ParentJourneyView } from '../domain/parentAccessContract';
import type { JourneyState } from '../domain/JourneyStateMachine';
import type { GovernedUser } from './authz';

// Phase 5A — Parent Trust Read Model. A thin composition layer ONLY: every
// fact here is read from an existing, already-authoritative service/
// repository (Journey Core, Current Location Projection, EtaService,
// audit_logs) — this file computes NOTHING itself (no state logic, no GPS
// math, no ETA math, no freshness math) and mutates NOTHING (imports no
// JourneyService/TelemetryIngestionService/CurrentLocationProjectionService-
// write/EtaAccuracyService/ActionExecutor/PolicyEngine/MasaraOperationsAgent
// function — the governance boundary holds by simple absence, exactly like
// every prior read-only phase).

export class ParentAccessDeniedError extends Error {}

type JourneyRow = ReturnType<typeof journeyRepository.findByStudentId>[number];

/**
 * Deterministic "which journey to show" rule (spec §13), the ONLY place
 * this decision is made:
 *   1. a journey currently in an active state (waiting/boarding/on_bus/
 *      in_transit/approaching_stop) — most recently updated wins;
 *   2. else a journey CREATED today — most recently updated wins (no
 *      `scheduledPickupTime` is guaranteed populated, so `createdAt` is the
 *      best available real, always-set field for "today's journey" without
 *      inventing a new one);
 *   3. else the single most recently created journey overall.
 * journeyRepository.findByStudentId already orders newest-first, so the
 * final fallback needs no extra sort.
 */
function selectRelevantJourney(journeys: JourneyRow[]): JourneyRow | null {
  if (journeys.length === 0) return null;

  const active = journeys.filter((j) => JOURNEY_ACTIVE_STATES.includes(j.state as JourneyState));
  if (active.length > 0) {
    return active.slice().sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  }

  const todayStr = new Date().toDateString();
  const today = journeys.filter((j) => j.createdAt.toDateString() === todayStr);
  if (today.length > 0) {
    return today.slice().sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  }

  return journeys[0];
}

function toEventView(row: ReturnType<typeof auditRepository.findByEntity>[number]): ParentJourneyEventView {
  return { id: row.id, eventType: row.eventType, occurredAt: row.createdAt.toISOString(), actorType: row.actorType };
}

/** Composes one ParentJourneyView from an already-resolved, already-authorized journey. Never throws — a missing trip/bus/route/location/ETA degrades to null fields, never a fabricated value (spec §6). */
function buildView(childId: string, childName: string, childLegacyStudentId: string | null, journey: JourneyRow | null): ParentJourneyView {
  if (!journey) {
    return { child: { id: childId, name: childName, legacyStudentId: childLegacyStudentId }, journey: null, bus: null, route: null, driver: null, location: null, eta: null, lastEvent: null };
  }

  const trip = tripRepository.findById(journey.tripId);
  const bus = trip ? busRepository.findById(trip.busId) : null;
  const route = trip ? routeRepository.findById(trip.routeId) : null;
  const driver = trip?.driverId ? driverRepository.findById(trip.driverId) : null;

  // Authorization chain stays Parent -> Child -> Journey -> Trip -> Bus ->
  // Current Location (spec §8) — never a general Parent -> Bus lookup. `bus`
  // is only ever reachable here because it was derived from THIS child's
  // own authorized journey/trip, never from a client-supplied busId.
  const location = bus ? getCurrentLocation(bus.id) : null;
  // ETA is read exclusively from the existing EtaService — no recomputation,
  // no ParentEtaService, no duplicated route-matching/speed/staleness/
  // confidence logic (spec §9). getTripEta already honestly reports UNKNOWN
  // if the bus's current telemetry has moved on to a different trip.
  const eta = trip ? getTripEta(trip.id) : null;

  const events = auditRepository.findByEntity('journey', journey.id);
  const lastEvent = events.length > 0 ? toEventView(events[events.length - 1]) : null;

  return {
    child: { id: childId, name: childName, legacyStudentId: childLegacyStudentId },
    journey: {
      id: journey.id,
      state: journey.state as JourneyState,
      currentStopId: journey.currentStopId,
      scheduledPickupTime: journey.scheduledPickupTime ? journey.scheduledPickupTime.toISOString() : null,
      scheduledDropoffTime: journey.scheduledDropoffTime ? journey.scheduledDropoffTime.toISOString() : null,
      boardedAt: journey.boardedAt ? journey.boardedAt.toISOString() : null,
      droppedOffAt: journey.droppedOffAt ? journey.droppedOffAt.toISOString() : null,
    },
    bus: bus ? { id: bus.id, label: bus.busNumber } : null,
    route: route ? { id: route.id, name: route.name } : null,
    driver: driver ? { displayName: driver.name } : null,
    location: location
      ? {
          latitude: location.latitude,
          longitude: location.longitude,
          speedKmh: location.speedKmh,
          heading: location.heading,
          source: location.source,
          freshness: location.freshness,
          occurredAt: location.occurredAt.toISOString(),
          receivedAt: location.receivedAt.toISOString(),
        }
      : null,
    eta: eta
      ? {
          status: eta.status,
          estimatedArrivalAt: eta.estimatedArrivalAt ? eta.estimatedArrivalAt.toISOString() : null,
          nextStopId: eta.nextStopId,
          confidence: eta.confidence,
          delaySeconds: eta.delay ? eta.delay.delaySeconds : null,
          source: eta.source,
          calculatedAt: eta.calculatedAt.toISOString(),
        }
      : null,
    lastEvent,
  };
}

/** Bounded — one authorized-student lookup, then one small per-child composition (spec §18; the pilot's authorized-child count is tiny, never a fleet-wide scan). */
export function getParentJourneys(parentUser: GovernedUser): ParentJourneyView[] {
  return resolveAuthorizedStudents(parentUser).map((student) => {
    const journey = selectRelevantJourney(journeyRepository.findByStudentId(student.id));
    return buildView(student.id, student.name, student.legacyStudentId, journey);
  });
}

/**
 * Parent-facing event timeline for ONE journey (spec §11) — reuses
 * JourneyService's existing audit pipeline (auditRepository.findByEntity)
 * directly rather than the human-operator HTTP endpoint
 * (GET /api/journeys/:id/events, gated by requireJourneyReader, which does
 * not include the parent role), filtered to the safe Journey-event
 * allow-list. Ownership is re-derived server-side from the authenticated
 * parent on every call — journeyId is never trusted as proof of access.
 * Returns null if the journey doesn't exist; throws ParentAccessDeniedError
 * if it exists but belongs to a student this parent isn't authorized for.
 */
export function getParentJourneyEvents(parentUser: GovernedUser, journeyId: string): ParentJourneyEventView[] | null {
  const journey = journeyRepository.findById(journeyId);
  if (!journey) return null;

  const authorized = resolveAuthorizedStudents(parentUser);
  if (!authorized.some((s) => s.id === journey.studentId)) {
    throw new ParentAccessDeniedError('هذه الرحلة الطلابية لا تخص أياً من أبنائك المصرح لك بمتابعتهم.');
  }

  return auditRepository
    .findByEntity('journey', journeyId)
    .filter((e) => PARENT_SAFE_EVENT_TYPES.has(e.eventType))
    .map(toEventView);
}
