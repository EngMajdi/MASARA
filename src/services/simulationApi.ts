import { ScenarioId, SimulationSession, SimulationStepResult, AuditEvent, GovernedTrip } from '../types';
import { legacyAuthHeaders } from './legacyAuthHeaders';

const BASE = '/api/simulation';

async function asJson<T>(res: Response, fallbackError: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || fallbackError);
  return data as T;
}

// Phase 11 SECURITY FIX — identity now proven via the real session token
// (see parentApi.ts's header comment) instead of a client-supplied
// `userEmail` query/body field. The three GET functions below previously
// sent no identity at all, matching a real gap found in the route inventory
// (those routes had no server-side guard whatsoever) — now fixed on both ends.

export function listSimulations(sessionToken: string | undefined): Promise<SimulationSession[]> {
  return fetch(BASE, { headers: legacyAuthHeaders(sessionToken) }).then((res) => asJson<SimulationSession[]>(res, 'تعذر تحميل قائمة المحاكاة.'));
}

export function startSimulation(scenario: ScenarioId, sessionToken: string | undefined, tripId?: string) {
  return fetch(`${BASE}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(sessionToken) },
    body: JSON.stringify({ scenario, tripId }),
  }).then((res) => asJson<{ success: true; session: SimulationSession }>(res, 'تعذر بدء المحاكاة.'));
}

export function getSimulation(id: string, sessionToken: string | undefined): Promise<SimulationSession> {
  return fetch(`${BASE}/${id}`, { headers: legacyAuthHeaders(sessionToken) }).then((res) => asJson<SimulationSession>(res, 'تعذر تحميل حالة المحاكاة.'));
}

export function getSimulationEvents(id: string, sessionToken: string | undefined): Promise<AuditEvent[]> {
  return fetch(`${BASE}/${id}/events`, { headers: legacyAuthHeaders(sessionToken) }).then((res) => asJson<AuditEvent[]>(res, 'تعذر تحميل أحداث المحاكاة.'));
}

export function advanceSimulation(id: string, sessionToken: string | undefined) {
  return fetch(`${BASE}/${id}/advance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(sessionToken) },
  }).then((res) =>
    asJson<{ success: true; result: SimulationStepResult; session: SimulationSession }>(res, 'تعذرت متابعة المحاكاة.')
  );
}

export function pauseSimulation(id: string, sessionToken: string | undefined) {
  return fetch(`${BASE}/${id}/pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(sessionToken) },
  }).then((res) => asJson<{ success: true; session: SimulationSession }>(res, 'تعذر إيقاف المحاكاة مؤقتاً.'));
}

export function resumeSimulation(id: string, sessionToken: string | undefined) {
  return fetch(`${BASE}/${id}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(sessionToken) },
  }).then((res) => asJson<{ success: true; session: SimulationSession }>(res, 'تعذر استئناف المحاكاة.'));
}

export function cancelSimulation(id: string, sessionToken: string | undefined) {
  return fetch(`${BASE}/${id}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(sessionToken) },
  }).then((res) => asJson<{ success: true; session: SimulationSession }>(res, 'تعذر إلغاء المحاكاة.'));
}

export function resetSimulations(sessionToken: string | undefined) {
  return fetch(`${BASE}/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(sessionToken) },
  }).then((res) => asJson<{ success: true }>(res, 'تعذر إعادة ضبط المحاكاة.'));
}

export function listGovernedTrips(sessionToken: string | undefined): Promise<GovernedTrip[]> {
  return fetch(`/api/trips`, { headers: legacyAuthHeaders(sessionToken) }).then((res) => asJson<GovernedTrip[]>(res, 'تعذر تحميل قائمة الرحلات.'));
}
