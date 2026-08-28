import {
  AIRecommendation,
  ActionVerification,
  AuditEvent,
  GovernedBus,
  GovernedPrediction,
  GovernedRoute,
  GovernedTrip,
} from '../types';
import { legacyAuthHeaders } from './legacyAuthHeaders';

const BASE = '/api/recommendations';

async function asJson<T>(res: Response, fallbackError: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data && data.error) || fallbackError);
  }
  return data as T;
}

// Phase 11 SECURITY FIX — these governance/reference reads AND the
// approve/reject/request-review actions used to trust a client-supplied
// `userEmail` completely, with no verification the caller actually held a
// session for it. The Phase 10 UAT confirmed this meant an unauthenticated
// caller who merely knew/guessed an admin/school email could remotely
// approve or reject a real AI-driven operational recommendation. Every call
// below now proves identity with the same real session token the legacy
// surface already requires; the server derives the caller's email from that
// verified session.
export function listRecommendations(sessionToken: string | undefined, status?: string): Promise<AIRecommendation[]> {
  const url = `${BASE}${status ? `?status=${encodeURIComponent(status)}` : ''}`;
  return fetch(url, { headers: legacyAuthHeaders(sessionToken) }).then((res) => asJson<AIRecommendation[]>(res, 'تعذر تحميل قائمة التوصيات.'));
}

export function getRecommendation(id: string, sessionToken: string | undefined): Promise<AIRecommendation> {
  return fetch(`${BASE}/${id}`, { headers: legacyAuthHeaders(sessionToken) }).then((res) => asJson<AIRecommendation>(res, 'تعذر تحميل تفاصيل التوصية.'));
}

export function getRecommendationAudit(id: string, sessionToken: string | undefined): Promise<AuditEvent[]> {
  return fetch(`${BASE}/${id}/audit`, { headers: legacyAuthHeaders(sessionToken) }).then((res) => asJson<AuditEvent[]>(res, 'تعذر تحميل سجل التدقيق.'));
}

export function getRecommendationVerification(id: string, sessionToken: string | undefined): Promise<ActionVerification | null> {
  return fetch(`${BASE}/${id}/verification`, { headers: legacyAuthHeaders(sessionToken) }).then((res) =>
    asJson<ActionVerification | null>(res, 'تعذر تحميل نتيجة التحقق.')
  );
}

export function getTrip(id: string, sessionToken: string | undefined): Promise<GovernedTrip> {
  return fetch(`/api/trips/${id}`, { headers: legacyAuthHeaders(sessionToken) }).then((res) => asJson<GovernedTrip>(res, 'تعذر تحميل بيانات الرحلة.'));
}

export function getGovernedBus(id: string, sessionToken: string | undefined): Promise<GovernedBus> {
  return fetch(`/api/buses/${id}`, { headers: legacyAuthHeaders(sessionToken) }).then((res) => asJson<GovernedBus>(res, 'تعذر تحميل بيانات الحافلة.'));
}

export function getGovernedRoute(id: string, sessionToken: string | undefined): Promise<GovernedRoute> {
  return fetch(`/api/routes/${id}`, { headers: legacyAuthHeaders(sessionToken) }).then((res) => asJson<GovernedRoute>(res, 'تعذر تحميل بيانات المسار.'));
}

export function getPrediction(id: string, sessionToken: string | undefined): Promise<GovernedPrediction> {
  return fetch(`/api/predictions/${id}`, { headers: legacyAuthHeaders(sessionToken) }).then((res) => asJson<GovernedPrediction>(res, 'تعذر تحميل بيانات التنبؤ.'));
}

export function approveRecommendationApi(id: string, sessionToken: string | undefined) {
  return fetch(`${BASE}/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(sessionToken) },
  }).then((res) => asJson<{ success: true; recommendation: AIRecommendation }>(res, 'تعذرت الموافقة على التوصية.'));
}

export function rejectRecommendationApi(id: string, sessionToken: string | undefined, reason: string) {
  return fetch(`${BASE}/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(sessionToken) },
    body: JSON.stringify({ reason }),
  }).then((res) => asJson<{ success: true; recommendation: AIRecommendation }>(res, 'تعذر رفض التوصية.'));
}

export function requestReviewApi(id: string, sessionToken: string | undefined, note?: string) {
  return fetch(`${BASE}/${id}/request-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(sessionToken) },
    body: JSON.stringify({ note }),
  }).then((res) => asJson<{ success: true; recommendation: AIRecommendation }>(res, 'تعذر تسجيل طلب المراجعة.'));
}
