import { Router } from 'express';
import { runForTrip } from '../agents/MasaraOperationsAgent';
import {
  approveRecommendation,
  rejectRecommendation,
  requestReview,
  RecommendationStateError,
  PolicyRejectionError,
  RecommendationExpiredError,
  ValidationError,
  ConflictError,
} from '../services/ActionExecutor';
import { recommendationRepository } from '../repositories/recommendationRepository';
import { actionRepository } from '../repositories/actionRepository';
import { actionVerificationRepository } from '../repositories/actionVerificationRepository';
import { auditRepository } from '../repositories/auditRepository';
import { tripRepository } from '../repositories/tripRepository';
import { busRepository } from '../repositories/busRepository';
import { routeRepository } from '../repositories/routeRepository';
import { predictionRepository } from '../repositories/predictionRepository';
import { userRepository } from '../repositories/userRepository';
import { requireOperationalUser, requireJourneyReader, requireVerifiedEmail } from '../services/authz';
import { isRouteAuthorizedForParent } from '../services/ParentAccessService';

// Additive governance API — new endpoints only, none of the existing routes in
// server.ts are touched here. This is the Approval Center's backend:
// AI -> Recommendation -> Policy -> Human Approval -> ActionExecutor -> Verify -> Audit
//
// Phase 11 SECURITY FIX (CRITICAL) — every route below used to resolve
// identity from a client-supplied `userEmail` query/body field, with no
// verification the caller actually held a session for that email. This
// included the approve/reject/request-review actions this whole governance
// model's "human review" gate depends on — the Phase 10 UAT confirmed this
// meant an unauthenticated caller who merely knew/guessed an admin/school
// email could remotely approve or reject a real AI-driven operational
// recommendation. Identity now comes from a real, verified session token
// (`requireVerifiedEmail`) on every single route in this file, no exceptions.
export const agentRouter = Router();

/** Maps ActionExecutor's typed errors to the right HTTP status — no raw stack traces ever reach the client. */
function handleExecutorError(err: unknown, res: import('express').Response) {
  if (err instanceof ValidationError) return res.status(422).json({ error: err.message });
  if (err instanceof RecommendationExpiredError) return res.status(409).json({ error: err.message, code: 'EXPIRED' });
  if (err instanceof ConflictError) return res.status(409).json({ error: err.message, code: 'CONFLICT' });
  if (err instanceof RecommendationStateError) return res.status(409).json({ error: err.message });
  if (err instanceof PolicyRejectionError) return res.status(422).json({ error: err.message });
  console.error('Recommendation decision error:', err);
  return res.status(500).json({ error: 'حدث خطأ غير متوقع أثناء معالجة الطلب.' });
}

agentRouter.post('/api/agent/run', async (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  try {
    const { tripId } = req.body;
    if (!tripId) return res.status(400).json({ error: 'tripId مطلوب.' });
    const result = await runForTrip(tripId);
    res.json({ success: true, result });
  } catch (err) {
    console.error('Agent run error:', err);
    res.status(500).json({ error: (err as Error).message || 'تعذر تشغيل وكيل مسارَا التشغيلي.' });
  }
});

// GET /api/recommendations?status=pending — read-only, supports the
// Approval Center's tabs (Pending/Approved/Rejected/Executed/...).
agentRouter.get('/api/recommendations', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const all = recommendationRepository.findAll();
  res.json(status ? all.filter((r) => r.status === status) : all);
});

agentRouter.get('/api/recommendations/:id', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  const rec = recommendationRepository.findById(req.params.id);
  if (!rec) return res.status(404).json({ error: 'التوصية غير موجودة.' });
  res.json(rec);
});

agentRouter.get('/api/recommendations/:id/audit', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  const rec = recommendationRepository.findById(req.params.id);
  if (!rec) return res.status(404).json({ error: 'التوصية غير موجودة.' });
  res.json(auditRepository.findByRecommendationId(req.params.id));
});

agentRouter.get('/api/recommendations/:id/verification', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  const rec = recommendationRepository.findById(req.params.id);
  if (!rec) return res.status(404).json({ error: 'التوصية غير موجودة.' });
  const actions = actionRepository.findByRecommendationId(req.params.id);
  if (actions.length === 0) return res.json(null);
  const verifications = actions.flatMap((a) => actionVerificationRepository.findByActionId(a.id));
  res.json(verifications[0] ?? null);
});

agentRouter.post('/api/recommendations/:id/approve', async (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  try {
    const result = await approveRecommendation(req.params.id, guard.user.id);
    res.json({ success: true, ...result });
  } catch (err) {
    handleExecutorError(err, res);
  }
});

agentRouter.post('/api/recommendations/:id/reject', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  try {
    const result = rejectRecommendation(req.params.id, guard.user.id, req.body?.reason);
    res.json({ success: true, recommendation: result });
  } catch (err) {
    handleExecutorError(err, res);
  }
});

agentRouter.post('/api/recommendations/:id/request-review', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  try {
    const result = requestReview(req.params.id, guard.user.id, req.body?.note);
    res.json({ success: true, recommendation: result });
  } catch (err) {
    handleExecutorError(err, res);
  }
});

// Phase 6D — production-readiness audit: audit_logs is append-only and
// grows without bound over a pilot's lifetime; this route (confirmed
// unused by the frontend or any test — dead/orphaned since Phase 2A) had
// no bound at all. Capped at the same 500-row ceiling
// telemetryObservationRepository already uses, via the existing
// findFiltered — auditRepository.findAll() itself is untouched (many
// isolation-snapshot tests across every phase rely on its exact
// unbounded semantics to compare full-table state).
agentRouter.get('/api/audit-logs', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(auditRepository.findFiltered({ limit: 500 }));
});

// Thin read-only pass-throughs onto the governed (Drizzle-backed) trip/bus/
// route/prediction data, distinct from the legacy in-memory mock endpoints
// already defined in server.ts (`/api/buses`, `/api/routes`, ...). Only the
// Approval Center's detail view (Situation / AI Prediction sections) needs
// these — no new business logic, just repository reads.
agentRouter.get('/api/trips', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireJourneyReader(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(tripRepository.findAll());
});

agentRouter.get('/api/trips/:id', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireJourneyReader(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  const trip = tripRepository.findById(req.params.id);
  if (!trip) return res.status(404).json({ error: 'الرحلة غير موجودة.' });
  res.json(trip);
});

// Phase 14 — governed bus listing. Previously there was no live way for the
// admin/school UI to even see the real governed buses (the ones journeys/
// GPS/Parent Live Journey actually run against) to link a legacy student to
// one (see server.ts's POST /api/students/:id/provision-governed). Read-only,
// same guard as the existing single-bus governed read below. Deliberately
// NOT `/api/buses` — that path is already the LEGACY bus list
// (server.ts, `legacyBusRepository.findAll()`) and mounting a second
// same-path route on the governed data would silently shadow one of them.
agentRouter.get('/api/governed/buses', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireJourneyReader(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(busRepository.findAll());
});

agentRouter.get('/api/buses/:id', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireJourneyReader(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  const bus = busRepository.findById(req.params.id);
  if (!bus) return res.status(404).json({ error: 'الحافلة غير موجودة.' });
  res.json(bus);
});

agentRouter.get('/api/routes/:id', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireJourneyReader(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  const route = routeRepository.findById(req.params.id);
  if (!route) return res.status(404).json({ error: 'المسار غير موجود.' });
  res.json(route);
});

// Stop metadata only (name/order/coordinates) — not GPS tracking, just the
// static route definition. Needed by the Driver Journey Console (Phase 3B
// §24/§40) to record which stop a student approached/was dropped off at,
// and by the Parent Live Journey map (ChildDetailSheet.tsx) to render stop
// markers for the parent's own child's route.
//
// Phase 15 — ownership-scoped for parents (spec §9): re-derives, server-side,
// whether ANY of this parent's real authorized children (ParentAccessService.
// isRouteAuthorizedForParent — the same Phase 13 identity bridge, never a
// client-supplied claim) currently has a trip running on the requested
// route. A parent who owns no child on this route gets 403, exactly like
// any other role that fails requireJourneyReader — never a broad "any
// parent can read any route's stops" grant. This does not widen
// JOURNEY_READ_ROLES itself; parent is handled as a distinct, narrower
// branch before falling back to the unchanged role check for every other
// caller (admin/school/driver — see requireJourneyReader's own docstring).
agentRouter.get('/api/routes/:id/stops', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });

  const requester = userRepository.findByEmail(identity.email);
  if (requester && requester.role === 'parent') {
    if (!isRouteAuthorizedForParent(requester, req.params.id)) {
      return res.status(403).json({ error: 'لا يمكنك الاطلاع على بيانات مسار لا يخص أياً من أبنائك.' });
    }
    return res.json(routeRepository.findStopsByRouteId(req.params.id));
  }

  const guard = requireJourneyReader(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(routeRepository.findStopsByRouteId(req.params.id));
});

agentRouter.get('/api/predictions/:id', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  const prediction = predictionRepository.findById(req.params.id);
  if (!prediction) return res.status(404).json({ error: 'التنبؤ غير موجود.' });
  res.json(prediction);
});
