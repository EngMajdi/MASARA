import { Router } from 'express';
import { runForTrip } from '../agents/MasaraOperationsAgent';
import { approveRecommendation, rejectRecommendation, RecommendationStateError, PolicyRejectionError } from '../services/ActionExecutor';
import { recommendationRepository } from '../repositories/recommendationRepository';
import { auditRepository } from '../repositories/auditRepository';
import { userRepository } from '../repositories/userRepository';

// Additive governance API — new endpoints only, none of the existing routes in
// server.ts are touched here. This demonstrates the full
// AI -> Recommendation -> Policy -> Human Approval -> ActionExecutor -> Verify -> Audit
// loop end-to-end via API/tests without requiring the (Phase 2) Approval UI.
export const agentRouter = Router();

const APPROVER_ROLES = new Set(['admin', 'school']);

type ApproverGuard = { ok: true } | { ok: false; status: number; error: string };

function requireApprover(userId: unknown): ApproverGuard {
  if (typeof userId !== 'string' || !userId) {
    return { ok: false, status: 400, error: 'userId مطلوب.' };
  }
  const user = userRepository.findById(userId);
  if (!user) return { ok: false, status: 404, error: 'المستخدم غير موجود.' };
  if (!APPROVER_ROLES.has(user.role)) {
    return { ok: false, status: 403, error: 'هذا المستخدم لا يملك صلاحية اتخاذ قرار على توصيات الذكاء الاصطناعي.' };
  }
  return { ok: true };
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

agentRouter.get('/api/recommendations', (_req, res) => {
  res.json(recommendationRepository.findAll());
});

agentRouter.get('/api/recommendations/:id', (req, res) => {
  const rec = recommendationRepository.findById(req.params.id);
  if (!rec) return res.status(404).json({ error: 'التوصية غير موجودة.' });
  res.json(rec);
});

agentRouter.post('/api/recommendations/:id/approve', (req, res) => {
  const guard = requireApprover(req.body?.userId);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  try {
    const result = approveRecommendation(req.params.id, req.body.userId);
    res.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof RecommendationStateError) return res.status(409).json({ error: err.message });
    if (err instanceof PolicyRejectionError) return res.status(422).json({ error: err.message });
    console.error('Approve recommendation error:', err);
    res.status(500).json({ error: 'تعذر تنفيذ التوصية.' });
  }
});

agentRouter.post('/api/recommendations/:id/reject', (req, res) => {
  const guard = requireApprover(req.body?.userId);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  try {
    const result = rejectRecommendation(req.params.id, req.body.userId, req.body?.reason);
    res.json({ success: true, recommendation: result });
  } catch (err) {
    if (err instanceof RecommendationStateError) return res.status(409).json({ error: err.message });
    console.error('Reject recommendation error:', err);
    res.status(500).json({ error: 'تعذر رفض التوصية.' });
  }
});

agentRouter.get('/api/audit-logs', (_req, res) => {
  res.json(auditRepository.findAll());
});
