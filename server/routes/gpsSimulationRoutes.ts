import { Router, type Response } from 'express';
import {
  startGpsSimulation,
  getGpsSession,
  listGpsSessions,
  advanceGpsSimulation,
  pauseGpsSimulation,
  resumeGpsSimulation,
  cancelGpsSimulation,
  resetAllGpsSimulations,
  GpsSimulationNotFoundError,
  GpsSimulationStateError,
  GpsRouteValidationError,
  GpsObservationValidationError,
  type GpsSimulationConfig,
  type SpeedProfile,
} from '../services/GpsSimulationEngine';
import { requireOperationalUser, requireVerifiedEmail } from '../services/authz';

// GPS Simulation controls (Phase 4A) — admin/school only, same governed
// gate as the Phase 2B scenario simulator (spec §35: a driver gets no GPS
// simulation control, a parent gets none, unauthenticated gets none — every
// endpoint here, including reads, requires requireOperationalUser; this is
// stricter than simulationRoutes.ts's unguarded GET endpoints on purpose,
// since Phase 4A's own spec §53 makes "unauthenticated -> rejected" a
// mandatory test for every operation).
//
// Phase 11 SECURITY FIX — identity now comes from a verified session token
// (`requireVerifiedEmail`), never a client-supplied `userEmail` query/body field.
export const gpsSimulationRouter = Router();

const VALID_SPEED_PROFILES = new Set<SpeedProfile>(['STOPPED', 'SLOW', 'NORMAL', 'FAST']);

function handleGpsError(err: unknown, res: Response) {
  if (err instanceof GpsSimulationNotFoundError) return res.status(404).json({ error: err.message });
  if (err instanceof GpsRouteValidationError) return res.status(422).json({ error: err.message });
  if (err instanceof GpsObservationValidationError) return res.status(422).json({ error: err.message });
  if (err instanceof GpsSimulationStateError) return res.status(409).json({ error: err.message });
  console.error('GPS simulation error:', err);
  return res.status(500).json({ error: 'حدث خطأ غير متوقع في محاكاة GPS.' });
}

gpsSimulationRouter.get('/api/gps-simulation', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(listGpsSessions());
});

gpsSimulationRouter.post('/api/gps-simulation/start', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const { tripId, speedProfile, tickSeconds, speedMultiplier } = req.body ?? {};
  if (typeof tripId !== 'string' || !tripId) {
    return res.status(422).json({ error: 'tripId مطلوب لبدء محاكاة GPS.' });
  }
  if (speedProfile !== undefined && !VALID_SPEED_PROFILES.has(speedProfile)) {
    return res.status(422).json({ error: `ملف سرعة غير صالح: "${speedProfile}".` });
  }

  const config: GpsSimulationConfig = {
    speedProfile: speedProfile as SpeedProfile | undefined,
    tickSeconds: typeof tickSeconds === 'number' ? tickSeconds : undefined,
    speedMultiplier: typeof speedMultiplier === 'number' ? speedMultiplier : undefined,
  };

  try {
    const session = startGpsSimulation(tripId, guard.user.id, config);
    res.json({ success: true, session });
  } catch (err) {
    handleGpsError(err, res);
  }
});

gpsSimulationRouter.post('/api/gps-simulation/reset', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  // In-memory bookkeeping only — no database table exists for GPS sessions
  // or observations (spec §31/§68).
  resetAllGpsSimulations();
  res.json({ success: true });
});

gpsSimulationRouter.get('/api/gps-simulation/:id', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  try {
    res.json(getGpsSession(req.params.id));
  } catch (err) {
    handleGpsError(err, res);
  }
});

gpsSimulationRouter.get('/api/gps-simulation/:id/observations', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  try {
    res.json(getGpsSession(req.params.id).observations);
  } catch (err) {
    handleGpsError(err, res);
  }
});

gpsSimulationRouter.post('/api/gps-simulation/:id/advance', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  try {
    const observation = advanceGpsSimulation(req.params.id);
    res.json({ success: true, observation, session: getGpsSession(req.params.id) });
  } catch (err) {
    handleGpsError(err, res);
  }
});

gpsSimulationRouter.post('/api/gps-simulation/:id/pause', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  try {
    res.json({ success: true, session: pauseGpsSimulation(req.params.id) });
  } catch (err) {
    handleGpsError(err, res);
  }
});

gpsSimulationRouter.post('/api/gps-simulation/:id/resume', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  try {
    res.json({ success: true, session: resumeGpsSimulation(req.params.id) });
  } catch (err) {
    handleGpsError(err, res);
  }
});

gpsSimulationRouter.post('/api/gps-simulation/:id/cancel', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  try {
    res.json({ success: true, session: cancelGpsSimulation(req.params.id) });
  } catch (err) {
    handleGpsError(err, res);
  }
});
