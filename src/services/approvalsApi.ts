import {
  AIRecommendation,
  ActionVerification,
  AuditEvent,
  GovernedBus,
  GovernedPrediction,
  GovernedRoute,
  GovernedTrip,
} from '../types';

const BASE = '/api/recommendations';

async function asJson<T>(res: Response, fallbackError: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data && data.error) || fallbackError);
  }
  return data as T;
}

// Phase 7A — these governance/reference reads now require an authorized
// session (admin/school for governance data, admin/school/driver for
// plain trip/bus/route reference data — see agentRoutes.ts), so every
// call site below must pass the caller's own email.
export function listRecommendations(userEmail: string, status?: string): Promise<AIRecommendation[]> {
  const url = `${BASE}?userEmail=${encodeURIComponent(userEmail)}${status ? `&status=${encodeURIComponent(status)}` : ''}`;
  return fetch(url).then((res) => asJson<AIRecommendation[]>(res, 'تعذر تحميل قائمة التوصيات.'));
}

export function getRecommendation(id: string, userEmail: string): Promise<AIRecommendation> {
  return fetch(`${BASE}/${id}?userEmail=${encodeURIComponent(userEmail)}`).then((res) => asJson<AIRecommendation>(res, 'تعذر تحميل تفاصيل التوصية.'));
}

export function getRecommendationAudit(id: string, userEmail: string): Promise<AuditEvent[]> {
  return fetch(`${BASE}/${id}/audit?userEmail=${encodeURIComponent(userEmail)}`).then((res) => asJson<AuditEvent[]>(res, 'تعذر تحميل سجل التدقيق.'));
}

export function getRecommendationVerification(id: string, userEmail: string): Promise<ActionVerification | null> {
  return fetch(`${BASE}/${id}/verification?userEmail=${encodeURIComponent(userEmail)}`).then((res) =>
    asJson<ActionVerification | null>(res, 'تعذر تحميل نتيجة التحقق.')
  );
}

export function getTrip(id: string, userEmail: string): Promise<GovernedTrip> {
  return fetch(`/api/trips/${id}?userEmail=${encodeURIComponent(userEmail)}`).then((res) => asJson<GovernedTrip>(res, 'تعذر تحميل بيانات الرحلة.'));
}

export function getGovernedBus(id: string, userEmail: string): Promise<GovernedBus> {
  return fetch(`/api/buses/${id}?userEmail=${encodeURIComponent(userEmail)}`).then((res) => asJson<GovernedBus>(res, 'تعذر تحميل بيانات الحافلة.'));
}

export function getGovernedRoute(id: string, userEmail: string): Promise<GovernedRoute> {
  return fetch(`/api/routes/${id}?userEmail=${encodeURIComponent(userEmail)}`).then((res) => asJson<GovernedRoute>(res, 'تعذر تحميل بيانات المسار.'));
}

export function getPrediction(id: string, userEmail: string): Promise<GovernedPrediction> {
  return fetch(`/api/predictions/${id}?userEmail=${encodeURIComponent(userEmail)}`).then((res) => asJson<GovernedPrediction>(res, 'تعذر تحميل بيانات التنبؤ.'));
}

// The backend resolves the governance-layer user by email — see the comment
// on requireApprover() in server/routes/agentRoutes.ts for why (the logged-in
// session identity and the governed `users` table are two literal stores from
// Phase 1's incremental migration; email is the field both share).
export function approveRecommendationApi(id: string, userEmail: string) {
  return fetch(`${BASE}/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail }),
  }).then((res) => asJson<{ success: true; recommendation: AIRecommendation }>(res, 'تعذرت الموافقة على التوصية.'));
}

export function rejectRecommendationApi(id: string, userEmail: string, reason: string) {
  return fetch(`${BASE}/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail, reason }),
  }).then((res) => asJson<{ success: true; recommendation: AIRecommendation }>(res, 'تعذر رفض التوصية.'));
}

export function requestReviewApi(id: string, userEmail: string, note?: string) {
  return fetch(`${BASE}/${id}/request-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail, note }),
  }).then((res) => asJson<{ success: true; recommendation: AIRecommendation }>(res, 'تعذر تسجيل طلب المراجعة.'));
}
