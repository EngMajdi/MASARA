import { userRepository } from '../repositories/userRepository';
import { OPERATIONAL_ROLES } from '../domain/roles';

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
