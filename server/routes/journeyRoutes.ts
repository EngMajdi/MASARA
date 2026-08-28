import { Router, type Response } from 'express';
import {
  getJourney,
  getStudentJourney,
  getTripJourneys,
  getTripJourneySummary,
  getJourneyTimeline,
  ensureJourneysForTrip,
  startJourney,
  startBoarding,
  boardStudent,
  startTransit,
  approachStop,
  dropOffStudent,
  completeJourney,
  markMissed,
  cancelJourney,
  markIncident,
  JourneyNotFoundError,
  JourneyConflictError,
  JourneyValidationError,
  type JourneyActor,
} from '../services/JourneyService';
import { InvalidJourneyTransitionError } from '../domain/JourneyStateMachine';
import { requireJourneyActor, requireJourneyReader, requireOperationalUser, requireDriverIdentity, requireVerifiedEmail } from '../services/authz';
import { tripRepository } from '../repositories/tripRepository';
import { studentRepository } from '../repositories/studentRepository';
import { busRepository } from '../repositories/busRepository';
import { routeRepository } from '../repositories/routeRepository';

// Journey Core API (spec Phase 3A §34). Every state-changing endpoint here
// only ever calls a named JourneyService function with a server-resolved
// actor — there is no generic "set state to X" endpoint, so a client can
// never submit an arbitrary target state (spec §11/§50, a deliberate
// hardening beyond the spec's own illustrative `POST .../transition` example).
//
// Phase 11 SECURITY FIX — every route below used to resolve identity from a
// client-supplied `userEmail` query/body field, with no verification the
// caller actually held a session for that email (Phase 10 UAT finding).
// Identity now comes from a real, verified session token
// (`requireVerifiedEmail`) on every route, including every journey-transition
// write below — a driver's real identity is what `requireJourneyActor`
// ownership-checks against, so this closes a real "any caller who knows a
// driver's email could operate that driver's trip" gap, not just a read leak.
export const journeyRouter = Router();

function handleJourneyError(err: unknown, res: Response) {
  if (err instanceof JourneyNotFoundError) return res.status(404).json({ error: err.message, code: 'JOURNEY_NOT_FOUND' });
  if (err instanceof InvalidJourneyTransitionError) {
    return res.status(422).json({ error: err.message, code: 'INVALID_JOURNEY_TRANSITION' });
  }
  if (err instanceof JourneyConflictError) return res.status(409).json({ error: err.message, code: 'JOURNEY_CONFLICT' });
  if (err instanceof JourneyValidationError) return res.status(422).json({ error: err.message, code: 'INVALID_JOURNEY_REQUEST' });
  console.error('Journey error:', err);
  return res.status(500).json({ error: 'حدث خطأ غير متوقع أثناء معالجة طلب الرحلة الطلابية.' });
}

type JourneyRow = NonNullable<ReturnType<typeof getJourney>>;

/** Attaches studentName/studentGrade for display — one bounded roster lookup per trip, never per-journey (no N+1). Additive fields only; the underlying JourneyService/journeyRepository shapes are untouched. */
function withStudentNames(journeys: JourneyRow[], busId: string) {
  const roster = studentRepository.findByBusId(busId);
  const byId = new Map(roster.map((s) => [s.id, s]));
  return journeys.map((j) => {
    const student = byId.get(j.studentId);
    return { ...j, studentName: student?.name ?? null, studentGrade: student?.grade ?? null };
  });
}

/** Resolves the target journey + a server-verified actor for a write operation, or writes the error response itself and returns null. */
function resolveActor(
  req: import('express').Request,
  res: Response,
  journeyId: string
): { actor: JourneyActor; journey: JourneyRow } | null {
  const journey = getJourney(journeyId);
  if (!journey) {
    res.status(404).json({ error: 'الرحلة الطلابية (Journey) غير موجودة.', code: 'JOURNEY_NOT_FOUND' });
    return null;
  }
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) {
    res.status(identity.status).json({ error: identity.error });
    return null;
  }
  const guard = requireJourneyActor(identity.email, journey.tripId);
  if (guard.ok === false) {
    res.status(guard.status).json({ error: guard.error });
    return null;
  }
  return { actor: { actorId: guard.actorId, actorType: guard.actorType }, journey };
}

// ---- Reads ----

journeyRouter.get('/api/journeys/:id', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const baseGuard = requireJourneyReader(identity.email);
  if (baseGuard.ok === false) return res.status(baseGuard.status).json({ error: baseGuard.error });
  const journey = getJourney(req.params.id);
  if (!journey) return res.status(404).json({ error: 'الرحلة الطلابية (Journey) غير موجودة.', code: 'JOURNEY_NOT_FOUND' });
  // Phase 3B §49: a driver may only read a Journey that belongs to their own trip.
  if (baseGuard.user.role === 'driver') {
    const scoped = requireJourneyReader(identity.email, journey.tripId);
    if (scoped.ok === false) return res.status(scoped.status).json({ error: scoped.error });
  }
  res.json(journey);
});

journeyRouter.get('/api/journeys/:id/events', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const baseGuard = requireJourneyReader(identity.email);
  if (baseGuard.ok === false) return res.status(baseGuard.status).json({ error: baseGuard.error });
  const journey = getJourney(req.params.id);
  if (!journey) return res.status(404).json({ error: 'الرحلة الطلابية (Journey) غير موجودة.', code: 'JOURNEY_NOT_FOUND' });
  if (baseGuard.user.role === 'driver') {
    const scoped = requireJourneyReader(identity.email, journey.tripId);
    if (scoped.ok === false) return res.status(scoped.status).json({ error: scoped.error });
  }
  try {
    res.json(getJourneyTimeline(req.params.id));
  } catch (err) {
    handleJourneyError(err, res);
  }
});

journeyRouter.get('/api/students/:studentId/journey', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const baseGuard = requireJourneyReader(identity.email);
  if (baseGuard.ok === false) return res.status(baseGuard.status).json({ error: baseGuard.error });
  const tripId = typeof req.query.tripId === 'string' ? req.query.tripId : undefined;
  const journey = getStudentJourney(req.params.studentId, tripId);
  if (!journey) return res.status(404).json({ error: 'لا توجد رحلة طلابية لهذا الطالب.', code: 'JOURNEY_NOT_FOUND' });
  if (baseGuard.user.role === 'driver') {
    const scoped = requireJourneyReader(identity.email, journey.tripId);
    if (scoped.ok === false) return res.status(scoped.status).json({ error: scoped.error });
  }
  res.json(journey);
});

journeyRouter.get('/api/trips/:tripId/journeys', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireJourneyReader(identity.email, req.params.tripId);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  const trip = tripRepository.findById(req.params.tripId);
  if (!trip) return res.status(404).json({ error: 'الرحلة غير موجودة.' });
  ensureJourneysForTrip(trip.id, { actorId: guard.user.id, actorType: guard.user.role as JourneyActor['actorType'] });
  res.json(withStudentNames(getTripJourneys(req.params.tripId), trip.busId));
});

journeyRouter.get('/api/trips/:tripId/journeys/summary', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireJourneyReader(identity.email, req.params.tripId);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(getTripJourneySummary(req.params.tripId));
});

// Driver Journey Console data source (Phase 3B §40) — the driver's OWN
// trips + their real journeys, resolved entirely from the authenticated
// identity via requireDriverIdentity. No tripId or driverId is ever accepted
// from the client here; a driver cannot ask for anyone else's roster.
journeyRouter.get('/api/driver/trips', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireDriverIdentity(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  const trips = tripRepository.findByDriverId(guard.driver.id);
  const withJourneys = trips.map((trip) => {
    const route = routeRepository.findById(trip.routeId);
    const bus = busRepository.findById(trip.busId);
    // Lazy/least-disruptive creation (spec §31): the first time this
    // driver's own trip is read, backfill Journeys for its roster.
    // ensureJourneysForTrip is idempotent, so this is a safe no-op on every
    // later call — it's what lets the Driver Console work without a
    // separate manual "initialize journeys" admin step.
    ensureJourneysForTrip(trip.id, { actorId: guard.user.id, actorType: 'driver' });
    return {
      trip,
      busNumber: bus?.busNumber ?? null,
      routeName: route?.name ?? null,
      journeys: withStudentNames(getTripJourneys(trip.id), trip.busId),
    };
  });
  res.json(withJourneys);
});

// ---- Creation (bulk backfill for a trip's roster — spec §30/§48) ----

journeyRouter.post('/api/trips/:tripId/journeys/ensure', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  try {
    const journeys = ensureJourneysForTrip(req.params.tripId, { actorId: guard.user.id, actorType: guard.user.role as JourneyActor['actorType'] });
    res.json({ success: true, journeys });
  } catch (err) {
    handleJourneyError(err, res);
  }
});

// ---- Transitions — one named endpoint per controlled operation, no generic setter ----

journeyRouter.post('/api/journeys/:id/start', (req, res) => {
  const resolved = resolveActor(req, res, req.params.id);
  if (!resolved) return;
  try {
    res.json({ success: true, journey: startJourney(resolved.journey.id, resolved.actor) });
  } catch (err) {
    handleJourneyError(err, res);
  }
});

journeyRouter.post('/api/journeys/:id/start-boarding', (req, res) => {
  const resolved = resolveActor(req, res, req.params.id);
  if (!resolved) return;
  try {
    res.json({ success: true, journey: startBoarding(resolved.journey.id, resolved.actor) });
  } catch (err) {
    handleJourneyError(err, res);
  }
});

journeyRouter.post('/api/journeys/:id/board', (req, res) => {
  const resolved = resolveActor(req, res, req.params.id);
  if (!resolved) return;
  try {
    res.json({ success: true, journey: boardStudent(resolved.journey.id, resolved.actor) });
  } catch (err) {
    handleJourneyError(err, res);
  }
});

journeyRouter.post('/api/journeys/:id/start-transit', (req, res) => {
  const resolved = resolveActor(req, res, req.params.id);
  if (!resolved) return;
  try {
    res.json({ success: true, journey: startTransit(resolved.journey.id, resolved.actor) });
  } catch (err) {
    handleJourneyError(err, res);
  }
});

journeyRouter.post('/api/journeys/:id/approach-stop', (req, res) => {
  const resolved = resolveActor(req, res, req.params.id);
  if (!resolved) return;
  const { stopId } = req.body ?? {};
  if (!stopId) return res.status(422).json({ error: 'stopId مطلوب.', code: 'INVALID_JOURNEY_REQUEST' });
  try {
    res.json({ success: true, journey: approachStop(resolved.journey.id, stopId, resolved.actor) });
  } catch (err) {
    handleJourneyError(err, res);
  }
});

journeyRouter.post('/api/journeys/:id/drop-off', (req, res) => {
  const resolved = resolveActor(req, res, req.params.id);
  if (!resolved) return;
  const { stopId } = req.body ?? {};
  if (!stopId) return res.status(422).json({ error: 'stopId مطلوب.', code: 'INVALID_JOURNEY_REQUEST' });
  try {
    res.json({ success: true, journey: dropOffStudent(resolved.journey.id, stopId, resolved.actor) });
  } catch (err) {
    handleJourneyError(err, res);
  }
});

journeyRouter.post('/api/journeys/:id/complete', (req, res) => {
  const resolved = resolveActor(req, res, req.params.id);
  if (!resolved) return;
  try {
    res.json({ success: true, journey: completeJourney(resolved.journey.id, resolved.actor) });
  } catch (err) {
    handleJourneyError(err, res);
  }
});

journeyRouter.post('/api/journeys/:id/missed', (req, res) => {
  const resolved = resolveActor(req, res, req.params.id);
  if (!resolved) return;
  try {
    res.json({ success: true, journey: markMissed(resolved.journey.id, req.body?.reason, resolved.actor) });
  } catch (err) {
    handleJourneyError(err, res);
  }
});

journeyRouter.post('/api/journeys/:id/cancel', (req, res) => {
  const resolved = resolveActor(req, res, req.params.id);
  if (!resolved) return;
  try {
    res.json({ success: true, journey: cancelJourney(resolved.journey.id, req.body?.reason, resolved.actor) });
  } catch (err) {
    handleJourneyError(err, res);
  }
});

journeyRouter.post('/api/journeys/:id/incident', (req, res) => {
  const resolved = resolveActor(req, res, req.params.id);
  if (!resolved) return;
  try {
    res.json({ success: true, journey: markIncident(resolved.journey.id, req.body?.reason, resolved.actor) });
  } catch (err) {
    handleJourneyError(err, res);
  }
});
