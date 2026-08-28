import { Router } from 'express';
import { getBusEta, getTripEta, getFleetEta } from '../services/EtaService';
import { getSummaryEtaAccuracy, getTripEtaAccuracy, type AccuracyView } from '../services/EtaAccuracyService';
import { requireTelemetryReader, requireOperationalUser, requireVerifiedEmail } from '../services/authz';

// ETA Intelligence read APIs (Phase 4D §16) — reuses Phase 4C's exact
// authorization model unchanged (requireTelemetryReader / requireOperationalUser):
// admin/school broad, driver scoped to their own bus/trip, parent excluded,
// unauthenticated/unknown rejected. No new authorization concept was
// introduced — the ETA boundary is exactly as safe as the telemetry read
// boundary it sits on top of. Read-only: no POST/PUT/PATCH/DELETE exists
// here at all.
//
// Phase 11 SECURITY FIX — identity now comes from a verified session token
// (`requireVerifiedEmail`), never a client-supplied `userEmail` query
// parameter (see authz.ts's header comment / Phase 10 UAT finding).
export const etaRouter = Router();

function toPublicEta(eta: ReturnType<typeof getBusEta>) {
  return {
    busId: eta.busId,
    tripId: eta.tripId,
    routeId: eta.routeId,
    nextStopId: eta.nextStopId,
    nextStopName: eta.nextStopName,
    estimatedArrivalAt: eta.estimatedArrivalAt ? eta.estimatedArrivalAt.toISOString() : null,
    finalDestinationEtaAt: eta.finalDestinationEtaAt ? eta.finalDestinationEtaAt.toISOString() : null,
    remainingDistanceMeters: eta.remainingDistanceMeters,
    remainingToDestinationMeters: eta.remainingToDestinationMeters,
    estimatedTravelSeconds: eta.estimatedTravelSeconds,
    currentSpeedKmh: eta.currentSpeedKmh,
    effectiveSpeedKmh: eta.effectiveSpeedKmh,
    confidence: eta.confidence,
    status: eta.status,
    source: eta.source,
    calculatedAt: eta.calculatedAt.toISOString(),
    explanation: eta.explanation,
    delay: eta.delay
      ? {
          scheduledArrivalAt: eta.delay.scheduledArrivalAt.toISOString(),
          delaySeconds: eta.delay.delaySeconds,
          classification: eta.delay.classification,
        }
      : null,
  };
}

// Registered before /bus/:busId and /trip/:tripId so "fleet" is never parsed as an id.
etaRouter.get('/api/eta/fleet', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(getFleetEta().map(toPublicEta));
});

etaRouter.get('/api/eta/bus/:busId', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireTelemetryReader(identity.email, { busId: req.params.busId });
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(toPublicEta(getBusEta(req.params.busId)));
});

etaRouter.get('/api/eta/trip/:tripId', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireTelemetryReader(identity.email, { tripId: req.params.tripId });
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(toPublicEta(getTripEta(req.params.tripId)));
});

// -----------------------------------------------------------------------
// Phase 4E — ETA accuracy validation. Read-only from the client's point of
// view (GET only, no client-supplied actualArrivalAt anywhere in this file)
// even though these two handlers trigger a bounded, on-demand reconciliation
// pass server-side before computing metrics — see EtaAccuracyService's
// header comment ("WRITE-TRIGGER ARCHITECTURE") for why that is the correct
// place for it. Authorization is entirely reused, unchanged, from the
// telemetry/ETA boundary these sit on top of.
// -----------------------------------------------------------------------

function toPublicAccuracy(view: AccuracyView) {
  return {
    sourceMix: view.sourceMix,
    totalCandidates: view.metrics.totalCandidates,
    measurableSamples: view.metrics.measurableSamples,
    coverage: view.metrics.coverage,
    maeSeconds: view.metrics.maeSeconds,
    biasSeconds: view.metrics.biasSeconds,
    bands: view.metrics.bands,
    byConfidence: view.metrics.byConfidence,
    bySource: view.metrics.bySource,
    byHorizon: view.metrics.byHorizon,
  };
}

// Admin/school only — fleet-wide accuracy summary (no bus/trip scope needed).
etaRouter.get('/api/eta/accuracy/summary', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(toPublicAccuracy(getSummaryEtaAccuracy()));
});

// Admin/school unscoped, driver scoped to their own trip (server-enforced, same guard as every other trip-scoped telemetry read).
etaRouter.get('/api/eta/accuracy/trips/:tripId', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireTelemetryReader(identity.email, { tripId: req.params.tripId });
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(toPublicAccuracy(getTripEtaAccuracy(req.params.tripId)));
});
