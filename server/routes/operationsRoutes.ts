import { Router } from 'express';
import { listOperationsEvents, type FeedCategory } from '../services/OperationsFeed';
import { requireOperationalUser } from '../services/authz';

// Read-only projection over audit_logs (spec §22/§24/§25) — admin/school only
// (spec §42/§43), same operational-role gate as everything else in Phase 2A/2B.
export const operationsRouter = Router();

const VALID_CATEGORIES = new Set<FeedCategory>(['all', 'ai', 'trips', 'students', 'approvals', 'actions', 'verification', 'safety']);

operationsRouter.get('/api/operations/events', (req, res) => {
  const guard = requireOperationalUser(req.query.userEmail);
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
