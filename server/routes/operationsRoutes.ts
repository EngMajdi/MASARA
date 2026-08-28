import { Router } from 'express';
import { listOperationsEvents, type FeedCategory } from '../services/OperationsFeed';
import { requireOperationalUser, requireVerifiedEmail } from '../services/authz';
import { tripRepository } from '../repositories/tripRepository';
import { busRepository } from '../repositories/busRepository';
import { routeRepository } from '../repositories/routeRepository';
import { driverRepository } from '../repositories/driverRepository';
import { getTripJourneySummary, ensureJourneysForTrip, type JourneyActor } from '../services/JourneyService';

// Read-only projection over audit_logs (spec §22/§24/§25) — admin/school only
// (spec §42/§43), same operational-role gate as everything else in Phase 2A/2B.
//
// Phase 11 SECURITY FIX — identity now comes from a verified session token
// (`requireVerifiedEmail`), never a client-supplied `userEmail` query parameter.
export const operationsRouter = Router();

const VALID_CATEGORIES = new Set<FeedCategory>(['all', 'ai', 'trips', 'students', 'approvals', 'actions', 'verification', 'safety']);

operationsRouter.get('/api/operations/events', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const { tripId, studentId, recommendationId, eventType, category, since, limit } = req.query;

  if (category && !VALID_CATEGORIES.has(category as FeedCategory)) {
    return res.status(422).json({ error: `تصنيف غير صالح: "${category}".` });
  }

  const events = listOperationsEvents({
    tripId: typeof tripId === 'string' ? tripId : undefined,
    studentId: typeof studentId === 'string' ? studentId : undefined,
    recommendationId: typeof recommendationId === 'string' ? recommendationId : undefined,
    eventType: typeof eventType === 'string' ? eventType : undefined,
    category: typeof category === 'string' ? (category as FeedCategory) : undefined,
    since: typeof since === 'string' ? new Date(since) : undefined,
    limit: typeof limit === 'string' ? Math.min(500, Math.max(1, parseInt(limit, 10) || 100)) : undefined,
  });

  res.json(events);
});

// School Journey Operations Panel aggregation (Phase 3B §35/§36) — one call
// for every active/scheduled trip's real, backend-derived Journey counts.
// Added specifically to avoid the frontend doing GET /api/trips then N calls
// to /api/trips/:tripId/journeys/summary (classic N+1); existing per-trip
// endpoints (Phase 3A) were confirmed insufficient for a cross-trip overview
// before adding this. No new state, no new table — pure aggregation over
// JourneyService.getTripJourneySummary, which already does the real counting.
operationsRouter.get('/api/operations/journeys', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const trips = tripRepository.findAll().filter((t) => t.status === 'active' || t.status === 'scheduled');
  // Bounded lookups (one per trip, and the pilot fleet has a handful of
  // trips) purely to attach human-readable labels — the counts themselves
  // still come only from getTripJourneySummary's real Journey rows.
  const overview = trips.map((trip) => {
    const bus = busRepository.findById(trip.busId);
    const route = routeRepository.findById(trip.routeId);
    const driver = trip.driverId ? driverRepository.findById(trip.driverId) : null;
    // Lazy/least-disruptive creation (spec §31) — same backfill the Driver
    // Console triggers, so the School Operations Panel reflects real counts
    // without a separate manual "initialize journeys" step.
    ensureJourneysForTrip(trip.id, { actorId: guard.user.id, actorType: guard.user.role as JourneyActor['actorType'] });
    return {
      trip,
      busNumber: bus?.busNumber ?? null,
      routeName: route?.name ?? null,
      driverName: driver?.name ?? null,
      summary: getTripJourneySummary(trip.id),
    };
  });
  res.json(overview);
});
