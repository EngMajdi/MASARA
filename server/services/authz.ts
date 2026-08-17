import { userRepository } from '../repositories/userRepository';
import { driverRepository } from '../repositories/driverRepository';
import { tripRepository } from '../repositories/tripRepository';
import { OPERATIONAL_ROLES, JOURNEY_READ_ROLES } from '../domain/roles';
import type { JourneyActor } from './JourneyService';

export type GovernedUser = NonNullable<ReturnType<typeof userRepository.findById>>;
export type AuthzGuard = { ok: true; user: GovernedUser } | { ok: false; status: number; error: string };

// The client's session identity comes from the legacy login system
// (server.ts's in-memory `users`); the governance layer's Drizzle `users`
// table is a separate literal store from Phase 1's incremental migration.
// Email is the field both share, so that's the join key — this resolves the
// same logged-in identity into the table the governance FKs actually point
// at, not a second auth system (see Phase 2A notes in agentRoutes.ts).
export function requireOperationalUser(email: unknown): AuthzGuard {
  if (typeof email !== 'string' || !email) {
    return { ok: false, status: 400, error: 'userEmail مطلوب.' };
  }
  const user = userRepository.findByEmail(email);
  if (!user) return { ok: false, status: 404, error: 'المستخدم غير موجود في نظام الحوكمة.' };
  if (!OPERATIONAL_ROLES.has(user.role)) {
    return { ok: false, status: 403, error: 'هذا المستخدم لا يملك صلاحية الوصول لهذه الميزة التشغيلية.' };
  }
  return { ok: true, user };
}

/** Read access for Journey data — admin/school/driver, never parent (spec §21/§49; parent read-scoping is future work, not built in Phase 3A). */
export function requireJourneyReader(email: unknown): AuthzGuard {
  if (typeof email !== 'string' || !email) {
    return { ok: false, status: 400, error: 'userEmail مطلوب.' };
  }
  const user = userRepository.findByEmail(email);
  if (!user) return { ok: false, status: 404, error: 'المستخدم غير موجود في نظام الحوكمة.' };
  if (!JOURNEY_READ_ROLES.has(user.role)) {
    return { ok: false, status: 403, error: 'هذا المستخدم لا يملك صلاحية الاطلاع على بيانات الرحلات الطلابية.' };
  }
  return { ok: true, user };
}

export type JourneyAuthzResult = ({ ok: true } & JourneyActor) | { ok: false; status: number; error: string };

/**
 * Journey Core authorization (spec Phase 3A §19/§20/§21). Admin/school get
 * broad operational visibility, same as the rest of the governed system.
 * A driver is verified end-to-end: real login identity -> governed user ->
 * driver record -> that driver's `id` actually matches `trips.driverId` for
 * THIS trip. A submitted driverId is never trusted (spec §19/§50) — identity
 * is derived from the authenticated email, never accepted as a body field.
 * Parent falls through to the final rejection: Phase 3A gives parents no
 * write path at all (read-only access is explicitly future work, spec §21).
 */
export function requireJourneyActor(email: unknown, tripId: string): JourneyAuthzResult {
  if (typeof email !== 'string' || !email) {
    return { ok: false, status: 400, error: 'userEmail مطلوب.' };
  }
  const user = userRepository.findByEmail(email);
  if (!user) return { ok: false, status: 404, error: 'المستخدم غير موجود في نظام الحوكمة.' };

  if (user.role === 'admin' || user.role === 'school') {
    return { ok: true, actorId: user.id, actorType: user.role };
  }

  if (user.role === 'driver') {
    const driver = driverRepository.findByUserId(user.id);
    if (!driver) return { ok: false, status: 403, error: 'لا يوجد سجل سائق مرتبط بهذا المستخدم.' };
    const trip = tripRepository.findById(tripId);
    if (!trip) return { ok: false, status: 404, error: 'الرحلة غير موجودة.' };
    if (trip.driverId !== driver.id) {
      return { ok: false, status: 403, error: 'هذا السائق غير مُكلّف بهذه الرحلة.' };
    }
    return { ok: true, actorId: user.id, actorType: 'driver' };
  }

  return { ok: false, status: 403, error: 'هذا المستخدم لا يملك صلاحية تعديل حالة الرحلة الطلابية.' };
}
