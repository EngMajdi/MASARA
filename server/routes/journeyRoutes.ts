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
import { requireJourneyActor, requireJourneyReader, requireOperationalUser } from '../services/authz';

// Journey Core API (spec Phase 3A §34). Every state-changing endpoint here
// only ever calls a named JourneyService function with a server-resolved
// actor — there is no generic "set state to X" endpoint, so a client can
// never submit an arbitrary target state (spec §11/§50, a deliberate
// hardening beyond the spec's own illustrative `POST .../transition` example).
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
  const guard = requireJourneyActor(req.body?.userEmail, journey.tripId);
  if (guard.ok === false) {
    res.status(guard.status).json({ error: guard.error });
    return null;
  }
  return { actor: { actorId: guard.actorId, actorType: guard.actorType }, journey };
}

// ---- Reads ----

journeyRouter.get('/api/journeys/:id', (req, res) => {
  const guard = requireJourneyReader(req.query.userEmail);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  const journey = getJourney(req.params.id);
  if (!journey) return res.status(404).json({ error: 'الرحلة الطلابية (Journey) غير موجودة.', code: 'JOURNEY_NOT_FOUND' });
  res.json(journey);
});

journeyRouter.get('/api/journeys/:id/events', (req, res) => {
  const guard = requireJourneyReader(req.query.userEmail);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  try {
    res.json(getJourneyTimeline(req.params.id));
  } catch (err) {
    handleJourneyError(err, res);
  }
});

journeyRouter.get('/api/students/:studentId/journey', (req, res) => {
  const guard = requireJourneyReader(req.query.userEmail);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  const tripId = typeof req.query.tripId === 'string' ? req.query.tripId : undefined;
  const journey = getStudentJourney(req.params.studentId, tripId);
  if (!journey) return res.status(404).json({ error: 'لا توجد رحلة طلابية لهذا الطالب.', code: 'JOURNEY_NOT_FOUND' });
  res.json(journey);
});

journeyRouter.get('/api/trips/:tripId/journeys', (req, res) => {
  const guard = requireJourneyReader(req.query.userEmail);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(getTripJourneys(req.params.tripId));
});

journeyRouter.get('/api/trips/:tripId/journeys/summary', (req, res) => {
  const guard = requireJourneyReader(req.query.userEmail);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(getTripJourneySummary(req.params.tripId));
});

// ---- Creation (bulk backfill for a trip's roster — spec §30/§48) ----

journeyRouter.post('/api/trips/:tripId/journeys/ensure', (req, res) => {
  const guard = requireOperationalUser(req.body?.userEmail);
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
