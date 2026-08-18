import { Router } from 'express';
import { requireParentUser } from '../services/authz';
import { getParentJourneys, getParentJourneyEvents, ParentAccessDeniedError } from '../services/ParentJourneyService';

// Parent Trust Read Model API (Phase 5A). Read-only: no POST/PUT/PATCH/
// DELETE exists here at all — a parent has no write path anywhere in this
// system. Smallest sufficient surface (spec §12/§36): the summary list
// already carries everything the main view needs (including `lastEvent`),
// so only one additional endpoint — the full per-journey timeline — was
// added; a standalone `/api/parent/journeys/:journeyId` detail lookup was
// deliberately NOT built since nothing in this phase's UI needs to refetch
// a single journey outside the summary list.
export const parentRouter = Router();

parentRouter.get('/api/parent/journeys', (req, res) => {
  const guard = requireParentUser(req.query.userEmail);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(getParentJourneys(guard.user));
});

parentRouter.get('/api/parent/journeys/:journeyId/events', (req, res) => {
  const guard = requireParentUser(req.query.userEmail);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  try {
    const events = getParentJourneyEvents(guard.user, req.params.journeyId);
    if (events === null) return res.status(404).json({ error: 'الرحلة الطلابية غير موجودة.' });
    res.json(events);
  } catch (err) {
    if (err instanceof ParentAccessDeniedError) return res.status(403).json({ error: err.message });
    console.error('Parent journey events error:', err);
    res.status(500).json({ error: 'حدث خطأ غير متوقع أثناء تحميل سجل أحداث الرحلة.' });
  }
});
