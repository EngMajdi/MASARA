import { GpsSimulationSession, SpeedProfile, TelemetryObservation } from '../types';
import { legacyAuthHeaders } from './legacyAuthHeaders';

const BASE = '/api/gps-simulation';

async function asJson<T>(res: Response, fallbackError: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || fallbackError);
  return data as T;
}

// Phase 11 SECURITY FIX — identity now proven via the real session token
// (see parentApi.ts's header comment) instead of a client-supplied
// `userEmail` query/body field, which the server previously trusted outright.

export function listGpsSimulations(sessionToken: string | undefined): Promise<GpsSimulationSession[]> {
  return fetch(`${BASE}`, { headers: legacyAuthHeaders(sessionToken) }).then((res) =>
    asJson<GpsSimulationSession[]>(res, 'تعذر تحميل قائمة محاكاة GPS.')
  );
}

export function startGpsSimulation(
  tripId: string,
  sessionToken: string | undefined,
  opts?: { speedProfile?: SpeedProfile; tickSeconds?: number; speedMultiplier?: number }
) {
  return fetch(`${BASE}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(sessionToken) },
    body: JSON.stringify({ tripId, ...opts }),
  }).then((res) => asJson<{ success: true; session: GpsSimulationSession }>(res, 'تعذر بدء محاكاة GPS.'));
}

export function getGpsSimulation(id: string, sessionToken: string | undefined): Promise<GpsSimulationSession> {
  return fetch(`${BASE}/${id}`, { headers: legacyAuthHeaders(sessionToken) }).then((res) =>
    asJson<GpsSimulationSession>(res, 'تعذر تحميل حالة محاكاة GPS.')
  );
}

export function getGpsObservations(id: string, sessionToken: string | undefined): Promise<TelemetryObservation[]> {
  return fetch(`${BASE}/${id}/observations`, { headers: legacyAuthHeaders(sessionToken) }).then((res) =>
    asJson<TelemetryObservation[]>(res, 'تعذر تحميل رصدات GPS.')
  );
}

export function advanceGpsSimulation(id: string, sessionToken: string | undefined) {
  return fetch(`${BASE}/${id}/advance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(sessionToken) },
  }).then((res) =>
    asJson<{ success: true; observation: TelemetryObservation; session: GpsSimulationSession }>(res, 'تعذرت متابعة محاكاة GPS.')
  );
}

export function pauseGpsSimulation(id: string, sessionToken: string | undefined) {
  return fetch(`${BASE}/${id}/pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(sessionToken) },
  }).then((res) => asJson<{ success: true; session: GpsSimulationSession }>(res, 'تعذر إيقاف محاكاة GPS مؤقتاً.'));
}

export function resumeGpsSimulation(id: string, sessionToken: string | undefined) {
  return fetch(`${BASE}/${id}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(sessionToken) },
  }).then((res) => asJson<{ success: true; session: GpsSimulationSession }>(res, 'تعذر استئناف محاكاة GPS.'));
}

export function cancelGpsSimulation(id: string, sessionToken: string | undefined) {
  return fetch(`${BASE}/${id}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(sessionToken) },
  }).then((res) => asJson<{ success: true; session: GpsSimulationSession }>(res, 'تعذر إلغاء محاكاة GPS.'));
}

export function resetGpsSimulations(sessionToken: string | undefined) {
  return fetch(`${BASE}/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(sessionToken) },
  }).then((res) => asJson<{ success: true }>(res, 'تعذر إعادة ضبط محاكاة GPS.'));
}
