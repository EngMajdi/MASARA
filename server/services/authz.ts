import { userRepository } from '../repositories/userRepository';
import { driverRepository } from '../repositories/driverRepository';
import { tripRepository } from '../repositories/tripRepository';
import { telemetryDeviceRepository } from '../repositories/telemetryDeviceRepository';
import { OPERATIONAL_ROLES, JOURNEY_READ_ROLES } from '../domain/roles';
import type { JourneyActor } from './JourneyService';
import { parseDeviceBearerToken, verifyDeviceSecret } from './deviceCredentials';

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

/**
 * Read access for Journey data — admin/school/driver, never parent (spec
 * §21/§49; parent read-scoping is future work, not built in Phase 3A).
 *
 * Phase 3B hardening: when `tripId` is supplied and the caller is a driver,
 * this also verifies that driver is actually assigned to that trip — the
 * same end-to-end identity check requireJourneyActor already does for
 * writes. Without this, any logged-in driver could read another driver's
 * trip roster/journeys/timeline by guessing a tripId, which the Phase 3B
 * mandatory security tests explicitly forbid. Admin/school stay unscoped.
 */
export function requireJourneyReader(email: unknown, tripId?: string): AuthzGuard {
  if (typeof email !== 'string' || !email) {
    return { ok: false, status: 400, error: 'userEmail مطلوب.' };
  }
  const user = userRepository.findByEmail(email);
  if (!user) return { ok: false, status: 404, error: 'المستخدم غير موجود في نظام الحوكمة.' };
  if (!JOURNEY_READ_ROLES.has(user.role)) {
    return { ok: false, status: 403, error: 'هذا المستخدم لا يملك صلاحية الاطلاع على بيانات الرحلات الطلابية.' };
  }
  if (tripId && user.role === 'driver') {
    const driver = driverRepository.findByUserId(user.id);
    if (!driver) return { ok: false, status: 403, error: 'لا يوجد سجل سائق مرتبط بهذا المستخدم.' };
    const trip = tripRepository.findById(tripId);
    if (!trip) return { ok: false, status: 404, error: 'الرحلة غير موجودة.' };
    if (trip.driverId !== driver.id) {
      return { ok: false, status: 403, error: 'هذا السائق غير مُكلّف بهذه الرحلة.' };
    }
  }
  return { ok: true, user };
}

/** Resolves the caller's OWN driver record from their authenticated email — never a client-submitted driverId (spec §19/§40/§50). */
export function requireDriverIdentity(
  email: unknown
): { ok: true; user: GovernedUser; driver: NonNullable<ReturnType<typeof driverRepository.findByUserId>> } | { ok: false; status: number; error: string } {
  if (typeof email !== 'string' || !email) {
    return { ok: false, status: 400, error: 'userEmail مطلوب.' };
  }
  const user = userRepository.findByEmail(email);
  if (!user) return { ok: false, status: 404, error: 'المستخدم غير موجود في نظام الحوكمة.' };
  if (user.role !== 'driver') {
    return { ok: false, status: 403, error: 'هذه الميزة مخصصة لتطبيق السائق فقط.' };
  }
  const driver = driverRepository.findByUserId(user.id);
  if (!driver) return { ok: false, status: 403, error: 'لا يوجد سجل سائق مرتبط بهذا المستخدم.' };
  return { ok: true, user, driver };
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

// ---------------------------------------------------------------------------
// Phase 4B — Telemetry device identity. A GPS device is NOT a school user
// (spec §12) — it authenticates with its own hashed secret via an
// `Authorization: Bearer <deviceId>.<secret>` header, never with a user
// email. This is a dedicated boundary, deliberately not layered on top of
// requireOperationalUser, whose semantics are specifically "a human user
// with this role".
// ---------------------------------------------------------------------------

export type AuthenticatedTelemetryDevice = { id: string; busId: string; providerType: 'DEVICE' | 'GPS_PROVIDER' };
export type TelemetryDeviceAuthResult = { ok: true; device: AuthenticatedTelemetryDevice } | { ok: false; status: number; error: string };

/**
 * Authenticates a device from its Authorization header. Every failure path
 * — missing header, unknown device, wrong secret, disabled, revoked —
 * returns the exact same status/message (spec §47: never let a response
 * reveal which of those was actually true; that would let an attacker
 * enumerate valid device ids or probe device status).
 */
export function requireTelemetryDevice(authorizationHeader: unknown): TelemetryDeviceAuthResult {
  const GENERIC_FAILURE = { ok: false as const, status: 401, error: 'بيانات اعتماد الجهاز غير صالحة.' };

  const parsed = parseDeviceBearerToken(authorizationHeader);
  if (!parsed) return GENERIC_FAILURE;

  const device = telemetryDeviceRepository.findById(parsed.deviceId);
  if (!device) return GENERIC_FAILURE;
  if (device.status !== 'active') return GENERIC_FAILURE; // disabled or revoked — same response as unknown (spec §6/§47)
  if (!verifyDeviceSecret(parsed.secret, device.secretHash)) return GENERIC_FAILURE;

  return {
    ok: true,
    device: { id: device.id, busId: device.busId, providerType: device.providerType as 'DEVICE' | 'GPS_PROVIDER' },
  };
}

/**
 * Telemetry read access (spec §82/§83). Admin/school get broad access,
 * same as every other operational read in this codebase. A driver MUST
 * supply a busId or tripId they are actually assigned to — an unscoped
 * driver query is rejected outright rather than silently returning
 * everything, since there is no "driver's own telemetry" without a target
 * to scope to. Parent falls through to the final rejection — no parent
 * telemetry access exists in Phase 4B (spec §82/§115).
 */
/**
 * Phase 5A — Parent Trust Read Model boundary. Deliberately its own guard,
 * not layered on requireOperationalUser/requireJourneyReader/
 * requireTelemetryReader — a parent is a distinct identity with its own
 * narrow, single-role scope (spec §4), never granted any of the broader
 * operational/driver read access those guards provide.
 */
export function requireParentUser(email: unknown): AuthzGuard {
  if (typeof email !== 'string' || !email) {
    return { ok: false, status: 400, error: 'userEmail مطلوب.' };
  }
  const user = userRepository.findByEmail(email);
  if (!user) return { ok: false, status: 404, error: 'المستخدم غير موجود في نظام الحوكمة.' };
  if (user.role !== 'parent') {
    return { ok: false, status: 403, error: 'هذه الميزة مخصصة لتطبيق ولي الأمر فقط.' };
  }
  return { ok: true, user };
}

/**
 * Phase 6A — "manage MY OWN record" boundary. Deliberately role-agnostic
 * (unlike requireOperationalUser/requireParentUser/requireTelemetryReader):
 * self-service contact management is a cross-role concept — admin, school,
 * driver, and parent should all be able to manage their own EMAIL/SMS/PUSH
 * contact addresses. This is NOT a new authorization model, just the same
 * email->governed-user resolution every other guard already uses, without
 * a role filter — ownership of a specific contact row is still re-derived
 * per-request from the row itself (UserContactService), never from this
 * guard alone.
 */
export function requireAuthenticatedUser(email: unknown): AuthzGuard {
  if (typeof email !== 'string' || !email) {
    return { ok: false, status: 400, error: 'userEmail مطلوب.' };
  }
  const user = userRepository.findByEmail(email);
  if (!user) return { ok: false, status: 404, error: 'المستخدم غير موجود في نظام الحوكمة.' };
  return { ok: true, user };
}

export function requireTelemetryReader(email: unknown, scope: { busId?: string; tripId?: string } = {}): AuthzGuard {
  if (typeof email !== 'string' || !email) {
    return { ok: false, status: 400, error: 'userEmail مطلوب.' };
  }
  const user = userRepository.findByEmail(email);
  if (!user) return { ok: false, status: 404, error: 'المستخدم غير موجود في نظام الحوكمة.' };

  if (user.role === 'admin' || user.role === 'school') {
    return { ok: true, user };
  }

  if (user.role === 'driver') {
    const driver = driverRepository.findByUserId(user.id);
    if (!driver) return { ok: false, status: 403, error: 'لا يوجد سجل سائق مرتبط بهذا المستخدم.' };

    if (scope.tripId) {
      const trip = tripRepository.findById(scope.tripId);
      if (!trip) return { ok: false, status: 404, error: 'الرحلة غير موجودة.' };
      if (trip.driverId !== driver.id) return { ok: false, status: 403, error: 'هذا السائق غير مُكلّف بهذه الرحلة.' };
      return { ok: true, user };
    }
    if (scope.busId) {
      const assigned = tripRepository.findByBusId(scope.busId).some((t) => t.driverId === driver.id);
      if (!assigned) return { ok: false, status: 403, error: 'هذا السائق غير مُكلّف بهذه الحافلة.' };
      return { ok: true, user };
    }
    return { ok: false, status: 422, error: 'يجب تحديد busId أو tripId عند الاطلاع على بيانات GPS كسائق.' };
  }

  return { ok: false, status: 403, error: 'هذا المستخدم لا يملك صلاحية الاطلاع على بيانات تتبع GPS.' };
}
