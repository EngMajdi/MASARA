import { Router } from 'express';
import { getTripSafetyFinding } from '../services/SafetyFindingService';
import { requireTelemetryReader } from '../services/authz';

// Phase 7B — Predictive Safety Intelligence read API. Reuses the exact same
// authorization boundary as the ETA read surface it sits on top of
// (requireTelemetryReader — admin/school broad, driver scoped to their own
// trip, parent/unauthenticated rejected). No new authorization mechanism
// introduced. Read-only: GET only, no client-supplied confidence/severity/
// classification anywhere in this file — every field of the response comes
// from SafetyFindingService's own computation.
export const safetyFindingRouter = Router();

safetyFindingRouter.get('/api/eta/findings/:tripId', (req, res) => {
  const guard = requireTelemetryReader(req.query.userEmail, { tripId: req.params.tripId });
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json({ finding: getTripSafetyFinding(req.params.tripId) });
});
