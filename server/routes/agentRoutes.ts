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
import { requireOperationalUser } from '../services/authz';

// Additive governance API — new endpoints only, none of the existing routes in
// server.ts are touched here. This is the Approval Center's backend:
// AI -> Recommendation -> Policy -> Human Approval -> ActionExecutor -> Verify -> Audit
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
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const all = recommendationRepository.findAll();
  res.json(status ? all.filter((r) => r.status === status) : all);
});

agentRouter.get('/api/recommendations/:id', (req, res) => {
  const rec = recommendationRepository.findById(req.params.id);
  if (!rec) return res.status(404).json({ error: 'التوصية غير موجودة.' });
  res.json(rec);
});

agentRouter.get('/api/recommendations/:id/audit', (req, res) => {
  const rec = recommendationRepository.findById(req.params.id);
  if (!rec) return res.status(404).json({ error: 'التوصية غير موجودة.' });
  res.json(auditRepository.findByRecommendationId(req.params.id));
});

agentRouter.get('/api/recommendations/:id/verification', (req, res) => {
  const rec = recommendationRepository.findById(req.params.id);
  if (!rec) return res.status(404).json({ error: 'التوصية غير موجودة.' });
  const actions = actionRepository.findByRecommendationId(req.params.id);
  if (actions.length === 0) return res.json(null);
  const verifications = actions.flatMap((a) => actionVerificationRepository.findByActionId(a.id));
  res.json(verifications[0] ?? null);
});

agentRouter.post('/api/recommendations/:id/approve', (req, res) => {
  const guard = requireOperationalUser(req.body?.userEmail);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  try {
    const result = approveRecommendation(req.params.id, guard.user.id);
    res.json({ success: true, ...result });
  } catch (err) {
    handleExecutorError(err, res);
  }
});

agentRouter.post('/api/recommendations/:id/reject', (req, res) => {
  const guard = requireOperationalUser(req.body?.userEmail);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  try {
    const result = rejectRecommendation(req.params.id, guard.user.id, req.body?.reason);
    res.json({ success: true, recommendation: result });
  } catch (err) {
    handleExecutorError(err, res);
  }
});

agentRouter.post('/api/recommendations/:id/request-review', (req, res) => {
  const guard = requireOperationalUser(req.body?.userEmail);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  try {
    const result = requestReview(req.params.id, guard.user.id, req.body?.note);
    res.json({ success: true, recommendation: result });
  } catch (err) {
    handleExecutorError(err, res);
  }
});

agentRouter.get('/api/audit-logs', (_req, res) => {
  res.json(auditRepository.findAll());
});

// Thin read-only pass-throughs onto the governed (Drizzle-backed) trip/bus/
// route/prediction data, distinct from the legacy in-memory mock endpoints
// already defined in server.ts (`/api/buses`, `/api/routes`, ...). Only the
// Approval Center's detail view (Situation / AI Prediction sections) needs
// these — no new business logic, just repository reads.
agentRouter.get('/api/trips', (_req, res) => {
  res.json(tripRepository.findAll());
});

agentRouter.get('/api/trips/:id', (req, res) => {
  const trip = tripRepository.findById(req.params.id);
  if (!trip) return res.status(404).json({ error: 'الرحلة غير موجودة.' });
  res.json(trip);
});

agentRouter.get('/api/buses/:id', (req, res) => {
  const bus = busRepository.findById(req.params.id);
  if (!bus) return res.status(404).json({ error: 'الحافلة غير موجودة.' });
  res.json(bus);
});

agentRouter.get('/api/routes/:id', (req, res) => {
  const route = routeRepository.findById(req.params.id);
  if (!route) return res.status(404).json({ error: 'المسار غير موجود.' });
  res.json(route);
});

agentRouter.get('/api/predictions/:id', (req, res) => {
  const prediction = predictionRepository.findById(req.params.id);
  if (!prediction) return res.status(404).json({ error: 'التنبؤ غير موجود.' });
  res.json(prediction);
});
