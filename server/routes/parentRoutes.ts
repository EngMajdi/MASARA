import { Router } from 'express';
import { requireParentUser, requireVerifiedEmail } from '../services/authz';
import { getParentJourneys, getParentJourneyEvents, ParentAccessDeniedError } from '../services/ParentJourneyService';
import {
  getNotificationsForParent,
  getUnreadCountForParent,
  markNotificationRead,
  NotificationNotFoundError,
  NotificationAccessDeniedError,
} from '../services/NotificationService';

// Parent Trust Read Model API (Phase 5A) + Governed Notifications (Phase 5B).
// Almost entirely read-only: the only write is POST .../notifications/:id/read
// (Phase 5B), a parent-owned communication-state change that never touches
// Journey/Trip/Bus/Student/ETA/Location/Telemetry. Smallest sufficient
// surface (spec §12/§36): the journeys summary list already carries
// everything the main view needs (including `lastEvent`), so only one
// additional journeys endpoint — the full per-journey timeline — was added;
// a standalone `/api/parent/journeys/:journeyId` detail lookup was
// deliberately NOT built since nothing in this phase's UI needs to refetch
// a single journey outside the summary list.
//
// Phase 11 SECURITY FIX — every handler below used to pass a client-supplied
// `userEmail` query/body field straight into `requireParentUser`, which was a
// complete authentication bypass (Phase 10 UAT: an unauthenticated
// `fetch('/api/parent/journeys?userEmail=parent@masara.om')` returned that
// parent's real children's live GPS/journey data). Every route now resolves
// the caller's identity from a real, verified session token first
// (`requireVerifiedEmail`) and only then passes that server-verified email
// into `requireParentUser` — the query/body `userEmail` field is no longer
// read anywhere in this file.
export const parentRouter = Router();

parentRouter.get('/api/parent/journeys', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireParentUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(getParentJourneys(guard.user));
});

parentRouter.get('/api/parent/journeys/:journeyId/events', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireParentUser(identity.email);
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

// -----------------------------------------------------------------------
// Phase 5B — Governed Notifications. Read-only from the client's point of
// view (no eventType/studentId/journeyId/tripId/recipientId/priority/
// sourceEventId ever accepted as input, spec §22) even though the GET
// handlers trigger a bounded, on-demand notification-processing pass
// server-side first — see NotificationService's header comment for why
// that is the correct place for it (the same "reconciliation-on-read"
// precedent Phase 4E already established). The only genuine mutation here
// is POST .../read, and it can only ever touch the authenticated parent's
// OWN notification row (ownership re-derived from the row itself, never
// trusted from the URL alone) — it never touches Journey/Trip/Bus/Student/
// ETA/Location/Telemetry.
// -----------------------------------------------------------------------

const DEFAULT_NOTIFICATION_LIMIT = 20;

parentRouter.get('/api/parent/notifications', async (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireParentUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  const rawLimit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : DEFAULT_NOTIFICATION_LIMIT;
  try {
    res.json(await getNotificationsForParent(guard.user, limit));
  } catch (err) {
    console.error('Parent notifications error:', err);
    res.status(500).json({ error: 'حدث خطأ غير متوقع أثناء تحميل الإشعارات.' });
  }
});

parentRouter.get('/api/parent/notifications/unread-count', async (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireParentUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  try {
    res.json({ count: await getUnreadCountForParent(guard.user) });
  } catch (err) {
    console.error('Parent unread-count error:', err);
    res.status(500).json({ error: 'حدث خطأ غير متوقع أثناء حساب عدد الإشعارات غير المقروءة.' });
  }
});

parentRouter.post('/api/parent/notifications/:id/read', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireParentUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  try {
    res.json(markNotificationRead(guard.user, req.params.id));
  } catch (err) {
    if (err instanceof NotificationNotFoundError) return res.status(404).json({ error: err.message });
    if (err instanceof NotificationAccessDeniedError) return res.status(403).json({ error: err.message });
    console.error('Mark notification read error:', err);
    res.status(500).json({ error: 'حدث خطأ غير متوقع أثناء تحديث حالة الإشعار.' });
  }
});
