import { ScenarioId, SimulationSession, SimulationStepResult, AuditEvent, GovernedTrip } from '../types';

const BASE = '/api/simulation';

async function asJson<T>(res: Response, fallbackError: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || fallbackError);
  return data as T;
}

export function listSimulations(): Promise<SimulationSession[]> {
  return fetch(BASE).then((res) => asJson<SimulationSession[]>(res, 'تعذر تحميل قائمة المحاكاة.'));
}

export function startSimulation(scenario: ScenarioId, userEmail: string, tripId?: string) {
  return fetch(`${BASE}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario, userEmail, tripId }),
  }).then((res) => asJson<{ success: true; session: SimulationSession }>(res, 'تعذر بدء المحاكاة.'));
}

export function getSimulation(id: string): Promise<SimulationSession> {
  return fetch(`${BASE}/${id}`).then((res) => asJson<SimulationSession>(res, 'تعذر تحميل حالة المحاكاة.'));
}

export function getSimulationEvents(id: string): Promise<AuditEvent[]> {
  return fetch(`${BASE}/${id}/events`).then((res) => asJson<AuditEvent[]>(res, 'تعذر تحميل أحداث المحاكاة.'));
}

export function advanceSimulation(id: string, userEmail: string) {
  return fetch(`${BASE}/${id}/advance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail }),
  }).then((res) =>
    asJson<{ success: true; result: SimulationStepResult; session: SimulationSession }>(res, 'تعذرت متابعة المحاكاة.')
  );
}

export function pauseSimulation(id: string, userEmail: string) {
  return fetch(`${BASE}/${id}/pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail }),
  }).then((res) => asJson<{ success: true; session: SimulationSession }>(res, 'تعذر إيقاف المحاكاة مؤقتاً.'));
}

export function resumeSimulation(id: string, userEmail: string) {
  return fetch(`${BASE}/${id}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail }),
  }).then((res) => asJson<{ success: true; session: SimulationSession }>(res, 'تعذر استئناف المحاكاة.'));
}

export function cancelSimulation(id: string, userEmail: string) {
  return fetch(`${BASE}/${id}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail }),
  }).then((res) => asJson<{ success: true; session: SimulationSession }>(res, 'تعذر إلغاء المحاكاة.'));
}

export function resetSimulations(userEmail: string) {
  return fetch(`${BASE}/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail }),
  }).then((res) => asJson<{ success: true }>(res, 'تعذر إعادة ضبط المحاكاة.'));
}

export function listGovernedTrips(): Promise<GovernedTrip[]> {
  return fetch('/api/trips').then((res) => asJson<GovernedTrip[]>(res, 'تعذر تحميل قائمة الرحلات.'));
}
