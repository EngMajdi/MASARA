import { Router, type Response } from 'express';
import {
  startSimulation,
  getSession,
  listSessions,
  advanceSimulation,
  pauseSimulation,
  resumeSimulation,
  cancelSimulation,
  listSessionEvents,
  resetAllSimulations,
  SimulationNotFoundError,
  InvalidScenarioError,
  SimulationStateError,
  type ScenarioId,
} from '../services/SimulationEngine';
import { requireOperationalUser } from '../services/authz';

// Simulation controls are operational-only (spec §16/§43) — a parent must
// never start a simulation, a driver gets none of these controls either.
export const simulationRouter = Router();

const VALID_SCENARIOS = new Set<ScenarioId>(['TRAFFIC_DELAY', 'MINOR_DELAY', 'NORMAL_TRIP', 'SAFETY_INCIDENT']);

function handleSimulationError(err: unknown, res: Response) {
  if (err instanceof SimulationNotFoundError) return res.status(404).json({ error: err.message });
  if (err instanceof InvalidScenarioError) return res.status(422).json({ error: err.message });
  if (err instanceof SimulationStateError) return res.status(409).json({ error: err.message });
  console.error('Simulation error:', err);
  return res.status(500).json({ error: 'حدث خطأ غير متوقع في محرك المحاكاة.' });
}

simulationRouter.get('/api/simulation', (_req, res) => {
  res.json(listSessions());
});

simulationRouter.post('/api/simulation/start', (req, res) => {
  const guard = requireOperationalUser(req.body?.userEmail);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const { scenario, tripId } = req.body ?? {};
  if (typeof scenario !== 'string' || !VALID_SCENARIOS.has(scenario as ScenarioId)) {
    return res.status(422).json({ error: `سيناريو غير صالح: "${scenario}".` });
  }

  try {
    const session = startSimulation(scenario as ScenarioId, guard.user.id, tripId);
    res.json({ success: true, session });
  } catch (err) {
    handleSimulationError(err, res);
  }
});

simulationRouter.post('/api/simulation/reset', (req, res) => {
  const guard = requireOperationalUser(req.body?.userEmail);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  // In-memory bookkeeping only — never touches audit_logs or any persisted
  // domain data (spec §40/AC-20).
  resetAllSimulations();
  res.json({ success: true });
});

simulationRouter.get('/api/simulation/:id', (req, res) => {
  try {
    res.json(getSession(req.params.id));
  } catch (err) {
    handleSimulationError(err, res);
  }
});

simulationRouter.get('/api/simulation/:id/events', (req, res) => {
  try {
    res.json(listSessionEvents(req.params.id));
  } catch (err) {
    handleSimulationError(err, res);
  }
});

simulationRouter.post('/api/simulation/:id/advance', async (req, res) => {
  const guard = requireOperationalUser(req.body?.userEmail);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  try {
    const result = await advanceSimulation(req.params.id);
    res.json({ success: true, result, session: getSession(req.params.id) });
  } catch (err) {
    handleSimulationError(err, res);
  }
});

simulationRouter.post('/api/simulation/:id/pause', (req, res) => {
  const guard = requireOperationalUser(req.body?.userEmail);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  try {
    res.json({ success: true, session: pauseSimulation(req.params.id) });
  } catch (err) {
    handleSimulationError(err, res);
  }
});

simulationRouter.post('/api/simulation/:id/resume', (req, res) => {
  const guard = requireOperationalUser(req.body?.userEmail);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  try {
    res.json({ success: true, session: resumeSimulation(req.params.id) });
  } catch (err) {
    handleSimulationError(err, res);
  }
});

simulationRouter.post('/api/simulation/:id/cancel', (req, res) => {
  const guard = requireOperationalUser(req.body?.userEmail);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  try {
    res.json({ success: true, session: cancelSimulation(req.params.id) });
  } catch (err) {
    handleSimulationError(err, res);
  }
});
