import { studentRepository } from '../repositories/studentRepository';
import { legacyUserRepository } from '../repositories/legacyUserRepository';
import { legacyStudentRepository } from '../repositories/legacyStudentRepository';
import { tripRepository } from '../repositories/tripRepository';
import type { GovernedUser } from './authz';

export type AuthorizedStudent = ReturnType<typeof studentRepository.findAll>[number];

/**
 * The one and only parent identity boundary (spec §4 / Phase 13).
 * Every caller (ParentJourneyService, parentRoutes.ts) is written against
 * this function's signature — `authenticatedParent -> authorizedStudentIds`
 * — never against `client -> studentId`.
 *
 * Phase 13 — replaces the Phase 5A DEMO-ONLY phone-matching mechanism
 * (`DEMO_PARENT_PHONE_BY_EMAIL` + a free-text `parentPhone` value-equality
 * read) with a real, stable, ID-based chain:
 *
 *   verified governed parent (session-authenticated, spec Phase 11)
 *     -> email join -> real legacy user (legacyUserRepository, same join
 *        every other governed guard already uses)
 *     -> legacy_students WHERE parentId = that legacy user's id (the real,
 *        tested Phase 7K ownership FK — the actual authoritative source of
 *        truth for parent<->student ownership; see
 *        docs/PHASE_13_STUDENT_IDENTITY_AND_PARENT_LIVE_JOURNEY_REPORT.md §6)
 *     -> governed students WHERE legacyStudentId = that legacy student's id
 *        (the new Phase 13 bridge column, database/schema.ts)
 *
 * No step in this chain compares a name, a phone number, or any other
 * display/presentation field. A legacy student with no governed
 * counterpart (legacyStudentId never set for it) is honestly excluded —
 * never guessed into inclusion.
 */
export function resolveAuthorizedStudents(parentUser: GovernedUser): AuthorizedStudent[] {
  const legacyParent = legacyUserRepository.findByEmail(parentUser.email);
  if (!legacyParent || legacyParent.role !== 'parent') return [];

  const ownedLegacyStudents = legacyStudentRepository.findAll().filter((s) => s.parentId === legacyParent.id);

  const governedStudents: AuthorizedStudent[] = [];
  for (const legacyStudent of ownedLegacyStudents) {
    const governedStudent = studentRepository.findByLegacyStudentId(legacyStudent.id);
    if (governedStudent) governedStudents.push(governedStudent);
  }
  return governedStudents;
}

/** Never trusts a client-supplied studentId as proof of ownership — always re-derives the authorized set server-side first (spec §4/§21). */
export function isStudentAuthorized(parentUser: GovernedUser, studentId: string): boolean {
  return resolveAuthorizedStudents(parentUser).some((s) => s.id === studentId);
}

/**
 * Phase 15 — the same "never trust a client-supplied ID, always re-derive
 * ownership server-side" discipline as isStudentAuthorized above, extended
 * one hop further: does this parent own a real, authorized child whose
 * bus currently has a trip on this exact route? Used to scope
 * GET /api/routes/:id/stops for the parent role (previously a flat 403 for
 * every parent, spec §9) without ever granting a parent broad "any route"
 * access — a parent with no child on the route gets false, and the caller
 * (server/routes/agentRoutes.ts) turns that into a 403, same as any other
 * unauthorized access.
 */
export function isRouteAuthorizedForParent(parentUser: GovernedUser, routeId: string): boolean {
  const authorizedStudents = resolveAuthorizedStudents(parentUser);
  for (const student of authorizedStudents) {
    if (!student.busId) continue;
    if (tripRepository.findByBusId(student.busId).some((t) => t.routeId === routeId)) return true;
  }
  return false;
}
