import { Router, type Response } from 'express';
import {
  ingestObservation,
  ingestDriverPhoneObservation,
  TelemetryValidationError,
  TelemetryCorrelationError,
  TelemetryNotFoundError,
  TelemetryConflictError,
  type TelemetryIngestionPayload,
} from '../services/TelemetryIngestionService';
import { telemetryObservationRepository } from '../repositories/telemetryObservationRepository';
import { requireTelemetryDevice, requireTelemetryReader, requireOperationalUser, requireVerifiedEmail, requireDriverIdentity } from '../services/authz';
import { getCurrentLocation, listFleetCurrentLocations, type CurrentLocationView } from '../services/CurrentLocationProjectionService';

// The telemetry ingestion boundary (Phase 4B §13) — one endpoint, one
// observation per request (spec §49/§50, no batch ingestion). This is
// deliberately NOT /api/events: every field is a specific telemetry
// observation field, never a client-chosen eventType/source (spec §16,
// §75 from Phase 3C — that prohibition still holds).
export const telemetryRouter = Router();

function handleTelemetryError(err: unknown, res: Response) {
  if (err instanceof TelemetryValidationError) return res.status(422).json({ error: err.message });
  if (err instanceof TelemetryCorrelationError) return res.status(403).json({ error: err.message });
  if (err instanceof TelemetryNotFoundError) return res.status(404).json({ error: err.message });
  if (err instanceof TelemetryConflictError) return res.status(409).json({ error: err.message });
  console.error('Telemetry ingestion error:', err);
  return res.status(500).json({ error: 'حدث خطأ غير متوقع أثناء استقبال بيانات GPS.' });
}

telemetryRouter.post('/api/telemetry/observations', (req, res) => {
  // Device ingestion is its own, already-real authentication boundary (a
  // device secret, not a user session) — untouched by the Phase 11 fix below.
  const guard = requireTelemetryDevice(req.headers.authorization);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const body = (req.body ?? {}) as TelemetryIngestionPayload;
  try {
    const result = ingestObservation(guard.device, body);
    // First acceptance -> 201 Created; an exact-duplicate resubmission is
    // idempotent success, not an error (spec §23) — 200, not 201, to
    // distinguish "already had this" from "just created this" while still
    // returning the same observation payload either way.
    res.status(result.kind === 'created' ? 201 : 200).json({ success: true, ...result });
  } catch (err) {
    handleTelemetryError(err, res);
  }
});

// Real-pilot GPS without dedicated hardware: a driver's own phone, sharing
// its own location for a trip that driver's own session actually owns.
// Identity comes exclusively from the driver's verified session token
// (requireVerifiedEmail + requireDriverIdentity — the exact same pair
// every other /api/driver/* route already uses), never from a client-
// supplied driverId. Ownership of the claimed tripId is re-verified inside
// ingestDriverPhoneObservation itself — this route never trusts the body
// beyond that it's a well-formed request.
telemetryRouter.post('/api/driver/telemetry', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireDriverIdentity(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const body = (req.body ?? {}) as { tripId: unknown; sourceEventId: unknown; occurredAt?: unknown; latitude: unknown; longitude: unknown; speedKmh?: unknown; heading?: unknown; accuracyMeters?: unknown };
  try {
    const result = ingestDriverPhoneObservation(guard.driver.id, body);
    res.status(result.kind === 'created' ? 201 : 200).json({ success: true, ...result });
  } catch (err) {
    handleTelemetryError(err, res);
  }
});

// Phase 11 SECURITY FIX (all routes below): identity now comes from a
// verified session token (`requireVerifiedEmail`), never a client-supplied
// `userEmail` query parameter — see authz.ts's header comment. This closes
// the exact class of vulnerability the Phase 10 UAT found: GPS location is
// sensitive transportation data and must never be readable by an
// unauthenticated caller who merely knows/guesses a role's email.

telemetryRouter.get('/api/telemetry/observations', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });

  const { busId, tripId, from, to, limit } = req.query;
  const busIdStr = typeof busId === 'string' ? busId : undefined;
  const tripIdStr = typeof tripId === 'string' ? tripId : undefined;

  const guard = requireTelemetryReader(identity.email, { busId: busIdStr, tripId: tripIdStr });
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const fromDate = typeof from === 'string' && !Number.isNaN(Date.parse(from)) ? new Date(from) : undefined;
  const toDate = typeof to === 'string' && !Number.isNaN(Date.parse(to)) ? new Date(to) : undefined;
  const limitNum = typeof limit === 'string' ? parseInt(limit, 10) : undefined;

  const observations = telemetryObservationRepository.findFiltered({
    busId: busIdStr,
    tripId: tripIdStr,
    from: fromDate,
    to: toDate,
    limit: Number.isFinite(limitNum) ? limitNum : undefined,
  });
  res.json(observations);
});

// ---------------------------------------------------------------------------
// Current Location Projection (Phase 4C) — conceptually distinct from the
// history endpoint above (spec §38): "what was observed?" vs. "what is the
// latest known location?". Reads current_location_projection directly, a
// single bounded query either way — never a scan of telemetry_observations
// per request (spec §16/§40). There is deliberately no POST/PUT/PATCH/
// DELETE here — the projection is server-derived only (spec §28).
// ---------------------------------------------------------------------------

function toPublicLocation(view: CurrentLocationView) {
  return {
    busId: view.busId,
    tripId: view.tripId,
    observationId: view.observationId,
    latitude: view.latitude,
    longitude: view.longitude,
    speed: view.speedKmh,
    heading: view.heading,
    accuracy: view.accuracyMeters,
    occurredAt: view.occurredAt.toISOString(),
    receivedAt: view.receivedAt.toISOString(),
    source: view.source,
    freshness: view.freshness,
  };
}

// Fleet-wide read — admin/school only (spec §16/§82): there is no
// "authorized scope" a driver could supply for an all-buses query, unlike
// the single-bus lookup below, so this reuses the same operational gate as
// every other fleet-wide operational summary (e.g. GET /api/operations/journeys).
// Registered BEFORE the /:busId route so "fleet" is never parsed as a busId.
telemetryRouter.get('/api/telemetry/current/fleet', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(listFleetCurrentLocations().map(toPublicLocation));
});

telemetryRouter.get('/api/telemetry/current/:busId', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  // Authorization happens BEFORE any existence/data check (spec §15) — a
  // driver requesting another driver's bus gets the same 403 whether or
  // not that bus even has a current-location row yet.
  const guard = requireTelemetryReader(identity.email, { busId: req.params.busId });
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const location = getCurrentLocation(req.params.busId);
  if (!location) {
    // No fabricated coordinates (spec §42) — an explicit, honest empty result.
    return res.status(404).json({ error: 'لا يوجد موقع حالي معروف لهذه الحافلة بعد.' });
  }
  res.json(toPublicLocation(location));
});
