import { validateSession } from './legacySessionService';

// Phase 7A — the authorization boundary for the legacy in-memory surface
// (server.ts's /api/students, /api/buses, /api/routes, /api/ai/*). Mirrors
// server/services/authz.ts's own guard shape and style exactly
// ({ok:true,user} | {ok:false,status,error}, generic non-enumerating
// messages) — a sibling to that guard family, not a replacement for it.
// The governed guards in authz.ts are untouched and still resolve
// identity from a client-claimed userEmail, exactly as every phase since
// 3A established; this file resolves identity from a real, expiring,
// server-issued session token instead, because the surface it protects
// never had ANY identity claim to trust in the first place (spec's own
// audit finding: these routes' frontend callers send no userEmail at
// all).

export interface LegacySessionUser {
  id: string;
  email: string;
  role: string;
}

export type LegacyAuthzGuard = { ok: true; user: LegacySessionUser } | { ok: false; status: number; error: string };

function extractBearerToken(authorizationHeader: unknown): string | null {
  if (typeof authorizationHeader !== 'string') return null;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/);
  return match ? match[1] : null;
}

/** Role-agnostic — any real, currently-valid session. The base check every other legacy guard builds on. */
export function requireLegacySession(authorizationHeader: unknown): LegacyAuthzGuard {
  const token = extractBearerToken(authorizationHeader);
  if (!token) {
    return { ok: false, status: 401, error: 'يجب تسجيل الدخول للوصول لهذه الميزة.' };
  }
  const session = validateSession(token);
  if (!session) {
    return { ok: false, status: 401, error: 'انتهت صلاحية الجلسة أو أنها غير صالحة. الرجاء تسجيل الدخول مرة أخرى.' };
  }
  return { ok: true, user: { id: session.userId, email: session.email, role: session.role } };
}

/** Session validity + an explicit allow-list of roles — the pattern every protected legacy route uses (spec: "reuse existing... primitives", same shape as authz.ts's requireOperationalUser/requireJourneyReader). */
export function requireLegacyRole(authorizationHeader: unknown, allowedRoles: readonly string[]): LegacyAuthzGuard {
  const guard = requireLegacySession(authorizationHeader);
  if (guard.ok === false) return guard;
  if (!allowedRoles.includes(guard.user.role)) {
    return { ok: false, status: 403, error: 'هذا الحساب لا يملك صلاحية تنفيذ هذا الإجراء.' };
  }
  return guard;
}

// Derived role semantics (spec Step 2 — "derive the actual intended role
// semantics from the existing implementation and frontend usage" — see
// Phase 7A audit): data management (create/delete students/buses/routes,
// AI route optimization) is an admin/school operation, matching
// OPERATIONAL_ROLES already established in server/domain/roles.ts.
// Driver-triggered operational actions (start-route, reroute detection)
// additionally allow driver. Student boarding/absence status and the
// legacy notification-test endpoint are reachable from the Parent Portal
// too (ParentPortal.tsx calls onUpdateStatus to mark a child absent) —
// broadened to all four roles. The legacy in-memory data model has no
// driver->bus or parent->student foreign key (unlike the governed Journey
// Core), so per-resource ownership scoping is NOT enforced here — a real
// but pre-existing data-model limitation, documented in the final report,
// not fabricated around with unreliable name-matching.
export const LEGACY_DATA_MANAGEMENT_ROLES = ['admin', 'school'] as const;
export const LEGACY_OPERATIONAL_ROLES = ['admin', 'school', 'driver'] as const;
export const LEGACY_ANY_ROLE = ['admin', 'school', 'driver', 'parent'] as const;

// Phase 8B — employee lifecycle (create/activate/deactivate/reset-credential/
// revoke-sessions) is deliberately admin-only, not admin/school like
// LEGACY_DATA_MANAGEMENT_ROLES: issuing a login credential is a materially
// more sensitive action than creating a bus/student/route record, and the
// two are kept as separate constants specifically so this narrower scope
// can't silently widen if LEGACY_DATA_MANAGEMENT_ROLES ever changes.
export const LEGACY_EMPLOYEE_MANAGEMENT_ROLES = ['admin'] as const;

// Phase 7K — the data-model limitation the comment above described (no
// driver->bus or parent->student FK) has now been closed for buses and
// students specifically (legacy_buses.driverId / legacy_students.parentId,
// see database/schema.ts). These two guards are the ownership layer that
// sits ON TOP of requireLegacyRole above, never in place of it — every
// call site still runs its existing role check first; these only narrow
// a role that already passed. Identity is always the session user
// resolved by requireLegacySession/requireLegacyRole; the resource is
// always loaded server-side by the caller (via legacyBusRepository /
// legacyStudentRepository) before either function runs. Neither function
// reads req.body — there is nothing here for a client to spoof.

/** admin/school: always allowed (existing behavior, unscoped). driver: allowed only for the bus they own. Any other role that reaches this point already failed requireLegacyRole. */
export function requireLegacyBusOwnership(user: LegacySessionUser, bus: { driverId: string | null }): LegacyAuthzGuard {
  if (user.role === 'admin' || user.role === 'school') return { ok: true, user };
  if (bus.driverId === user.id) return { ok: true, user };
  return { ok: false, status: 403, error: 'هذا الحساب لا يملك صلاحية التحكم بهذه الحافلة.' };
}

/** admin/school/driver: always allowed (existing behavior, unscoped — drivers still mark boarding/absence for any student on their run). parent: allowed only for their own child. */
export function requireLegacyStudentOwnership(user: LegacySessionUser, student: { parentId: string | null }): LegacyAuthzGuard {
  if (user.role === 'admin' || user.role === 'school' || user.role === 'driver') return { ok: true, user };
  if (student.parentId === user.id) return { ok: true, user };
  return { ok: false, status: 403, error: 'هذا الحساب لا يملك صلاحية تحديث حالة هذا الطالب.' };
}
