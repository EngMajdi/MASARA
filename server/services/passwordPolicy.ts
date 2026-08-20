// Phase 7H — production security audit finding: neither /api/auth/register
// nor any password-bearing route validated password strength at all
// (only a truthy check — a single-character password was accepted).
// Deliberately conservative per the phase's own instruction ("do not
// invent arbitrary enterprise complexity theater"): a minimum length
// only, no required character classes. 8 characters matches NIST SP
// 800-63B's own baseline minimum for user-chosen passwords and is
// comfortably satisfied by every seeded demo credential ('password123',
// 11 characters) — no seed data needed to change for this policy to be
// safe to enable immediately.
//
// This module is a pure, deterministic function — no I/O, no hashing, no
// logging. It never receives or returns anything that should be logged;
// callers are responsible for never logging the raw password either way.

export const MIN_PASSWORD_LENGTH = 8;

export type PasswordPolicyResult = { valid: true } | { valid: false; error: string };

export function validatePasswordPolicy(password: unknown): PasswordPolicyResult {
  if (typeof password !== 'string' || password.length === 0) {
    return { valid: false, error: 'كلمة المرور مطلوبة.' };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, error: `يجب أن تتكون كلمة المرور من ${MIN_PASSWORD_LENGTH} أحرف على الأقل.` };
  }
  return { valid: true };
}
