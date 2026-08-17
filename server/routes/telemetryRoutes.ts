import { Router, type Response } from 'express';
import {
  ingestObservation,
  TelemetryValidationError,
  TelemetryCorrelationError,
  TelemetryNotFoundError,
  TelemetryConflictError,
  type TelemetryIngestionPayload,
} from '../services/TelemetryIngestionService';
import { telemetryObservationRepository } from '../repositories/telemetryObservationRepository';
import { requireTelemetryDevice, requireTelemetryReader, requireOperationalUser } from '../services/authz';
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

telemetryRouter.get('/api/telemetry/observations', (req, res) => {
  const { busId, tripId, from, to, limit } = req.query;
  const busIdStr = typeof busId === 'string' ? busId : undefined;
  const tripIdStr = typeof tripId === 'string' ? tripId : undefined;

  const guard = requireTelemetryReader(req.query.userEmail, { busId: busIdStr, tripId: tripIdStr });
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
  const guard = requireOperationalUser(req.query.userEmail);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(listFleetCurrentLocations().map(toPublicLocation));
});

telemetryRouter.get('/api/telemetry/current/:busId', (req, res) => {
  // Authorization happens BEFORE any existence/data check (spec §15) — a
  // driver requesting another driver's bus gets the same 403 whether or
  // not that bus even has a current-location row yet.
  const guard = requireTelemetryReader(req.query.userEmail, { busId: req.params.busId });
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const location = getCurrentLocation(req.params.busId);
  if (!location) {
    // No fabricated coordinates (spec §42) — an explicit, honest empty result.
    return res.status(404).json({ error: 'لا يوجد موقع حالي معروف لهذه الحافلة بعد.' });
  }
  res.json(toPublicLocation(location));
});
