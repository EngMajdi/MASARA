import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Phase 6D — production-readiness audit finding: the legacy in-memory
// login store (server.ts's own `users` array, predating the governed
// Drizzle `users` table) stored and compared passwords in plaintext
// (`user.password !== password`). That is the literal front door for
// every role in this application — whoever passes this check receives a
// session identity used as `userEmail` against every governed API for the
// rest of the session — so hardening it is a real production concern, not
// cosmetic.
//
// Same scrypt+salt+constant-time-verify convention already established by
// deviceCredentials.ts (Phase 4B) and ContactVerificationService.ts
// (Phase 6B) — a fourth independent copy rather than a shared import,
// matching this codebase's existing precedent of one small boundary-local
// helper per concern. This does NOT introduce a second identity model:
// it is the exact same one legacy mechanism, with its one weak spot
// (plaintext storage/comparison) fixed. No new dependency, no new API
// shape, no behavior change visible to a caller — the same demo
// credentials still work identically from the login UI.

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/** Constant-time comparison — never a plain string `===` (the exact weakness this replaces). */
export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

// Phase 8B — the temporary credential issued to a newly provisioned
// employee (or on a credential reset), returned once in the API response
// and never persisted in plaintext (only its hash, via hashPassword above,
// exactly like a real self-chosen password). 9 random bytes / 12
// base64url characters ~= 72 bits of entropy — the same
// randomBytes(...).toString(...) convention already used for session
// tokens (legacySessionService.ts), device secrets (deviceCredentials.ts),
// and verification codes (ContactVerificationService.ts), sized to be
// short enough for an admin to read aloud/type on a keyboard rather than
// a 48-character hex string. Always satisfies the existing length-only
// password policy (MIN_PASSWORD_LENGTH=8) with room to spare.
export function generateTemporaryPassword(): string {
  return randomBytes(9).toString('base64url');
}
