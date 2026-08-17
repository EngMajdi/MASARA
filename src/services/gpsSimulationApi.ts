import { GpsSimulationSession, SpeedProfile, TelemetryObservation } from '../types';

const BASE = '/api/gps-simulation';

async function asJson<T>(res: Response, fallbackError: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || fallbackError);
  return data as T;
}

export function listGpsSimulations(userEmail: string): Promise<GpsSimulationSession[]> {
  return fetch(`${BASE}?userEmail=${encodeURIComponent(userEmail)}`).then((res) =>
    asJson<GpsSimulationSession[]>(res, 'تعذر تحميل قائمة محاكاة GPS.')
  );
}

export function startGpsSimulation(
  tripId: string,
  userEmail: string,
  opts?: { speedProfile?: SpeedProfile; tickSeconds?: number; speedMultiplier?: number }
) {
  return fetch(`${BASE}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tripId, userEmail, ...opts }),
  }).then((res) => asJson<{ success: true; session: GpsSimulationSession }>(res, 'تعذر بدء محاكاة GPS.'));
}

export function getGpsSimulation(id: string, userEmail: string): Promise<GpsSimulationSession> {
  return fetch(`${BASE}/${id}?userEmail=${encodeURIComponent(userEmail)}`).then((res) =>
    asJson<GpsSimulationSession>(res, 'تعذر تحميل حالة محاكاة GPS.')
  );
}

export function getGpsObservations(id: string, userEmail: string): Promise<TelemetryObservation[]> {
  return fetch(`${BASE}/${id}/observations?userEmail=${encodeURIComponent(userEmail)}`).then((res) =>
    asJson<TelemetryObservation[]>(res, 'تعذر تحميل رصدات GPS.')
  );
}

export function advanceGpsSimulation(id: string, userEmail: string) {
  return fetch(`${BASE}/${id}/advance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail }),
  }).then((res) =>
    asJson<{ success: true; observation: TelemetryObservation; session: GpsSimulationSession }>(res, 'تعذرت متابعة محاكاة GPS.')
  );
}

export function pauseGpsSimulation(id: string, userEmail: string) {
  return fetch(`${BASE}/${id}/pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail }),
  }).then((res) => asJson<{ success: true; session: GpsSimulationSession }>(res, 'تعذر إيقاف محاكاة GPS مؤقتاً.'));
}

export function resumeGpsSimulation(id: string, userEmail: string) {
  return fetch(`${BASE}/${id}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail }),
  }).then((res) => asJson<{ success: true; session: GpsSimulationSession }>(res, 'تعذر استئناف محاكاة GPS.'));
}

export function cancelGpsSimulation(id: string, userEmail: string) {
  return fetch(`${BASE}/${id}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail }),
  }).then((res) => asJson<{ success: true; session: GpsSimulationSession }>(res, 'تعذر إلغاء محاكاة GPS.'));
}

export function resetGpsSimulations(userEmail: string) {
  return fetch(`${BASE}/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail }),
  }).then((res) => asJson<{ success: true }>(res, 'تعذر إعادة ضبط محاكاة GPS.'));
}
