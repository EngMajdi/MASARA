import { studentRepository } from '../repositories/studentRepository';
import { DEMO_PARENT_PHONE_BY_EMAIL } from '../domain/parentAccessContract';
import type { GovernedUser } from './authz';

export type AuthorizedStudent = ReturnType<typeof studentRepository.findAll>[number];

/**
 * The one and only parent identity boundary (spec §4). Every caller
 * (ParentJourneyService, parentRoutes.ts) is written against this
 * function's signature — `authenticatedParent -> authorizedStudentIds` —
 * never against `client -> studentId`. See parentAccessContract.ts's header
 * comment for the full DEMO-ONLY rationale and the exact seam a future real
 * identity provider would replace.
 */
export function resolveAuthorizedStudents(parentUser: GovernedUser): AuthorizedStudent[] {
  const demoPhone = DEMO_PARENT_PHONE_BY_EMAIL[parentUser.email];
  if (!demoPhone) return [];
  return studentRepository.findByParentPhone(demoPhone);
}

/** Never trusts a client-supplied studentId as proof of ownership — always re-derives the authorized set server-side first (spec §4/§21). */
export function isStudentAuthorized(parentUser: GovernedUser, studentId: string): boolean {
  return resolveAuthorizedStudents(parentUser).some((s) => s.id === studentId);
}
