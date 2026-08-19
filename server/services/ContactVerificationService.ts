import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { userContactRepository } from '../repositories/userContactRepository';
import { requireOwnContact, toView, ContactNotFoundError, ContactAccessDeniedError, type ContactRow } from './UserContactService';
import type { ContactChannel, ContactView } from '../domain/contactContract';
import type { GovernedUser } from './authz';

// Phase 6B — the smallest honest verification boundary this architecture
// currently supports. There is NO OTP provider, NO SMS vendor, NO email
// vendor, NO push provider connected anywhere in this codebase (Phase
// 5C/5D architecture audits, unchanged) — this service does not, and
// structurally cannot, claim a contact was proven to belong to its owner
// through a real external channel. It exists so a future real delivery
// integration (a real SMS/email OTP send) is a drop-in addition to
// requestVerification below, without UserContactService, NotificationService,
// or the API surface changing shape.
//
// requestVerification generates a REAL random challenge (never a fixed,
// hardcoded, or predictable fake code), hashes it with the same
// scrypt+salt convention deviceCredentials.ts already established for
// device secrets, and persists only the hash + an expiry on the contact
// row itself (no new table — Phase 6A's user_contacts already has one row
// per contact; a challenge is state ABOUT that row, not a new entity, so
// two nullable columns are the smallest additive schema, not a new table).
//
// The plaintext code is NEVER returned to any API caller and NEVER
// logged. This is a deliberate asymmetry with deviceCredentials.ts: a
// device secret is handed back to the device that requested it, because
// the device IS the direct recipient over that same request/response —
// but a contact verification code only proves anything if it reaches the
// user through the ACTUAL external channel (a real inbox, a real SMS).
// Handing it back over the same API call that asked for it would prove
// nothing about ownership. Since no real transport exists in this
// deployment, requestVerification honestly reports that delivery is
// unavailable — never a simulated "sent" status.
//
// confirmVerification only ever succeeds against a real, unexpired,
// previously-requested challenge for THIS EXACT contact, owned by the
// authenticated caller. Absent that challenge (never requested, expired,
// or already consumed), confirmation is unavailable — never a bypass,
// never a fabricated success, never a hardcoded/backdoor code.

export class ContactDisabledError extends Error {}
export class VerificationUnavailableError extends Error {}
export class InvalidVerificationCodeError extends Error {}
export { ContactNotFoundError, ContactAccessDeniedError };

/** Long enough for a real vendor round-trip in principle; short enough that a never-delivered challenge cannot be confirmed indefinitely. */
const CHALLENGE_TTL_MS = 15 * 60 * 1000;

/**
 * Exported as pure functions purely for direct unit-testing of the hashing
 * mechanics (the same precedent Phase 5D set with classifyEmailProviderResponse
 * et al.) — no route or any other module ever calls these directly; the
 * plaintext code they produce/consume never crosses an API boundary.
 */
export function generateVerificationCode(): string {
  return randomBytes(24).toString('hex');
}

/** Same scrypt+salt convention as deviceCredentials.ts — never a plain string comparison, never a plaintext store. */
export function hashVerificationCode(code: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(code, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyVerificationCode(code: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(code, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export interface VerificationRequestResult {
  status: 'PENDING';
  channel: ContactChannel;
  expiresAt: string;
  delivered: false;
  message: string;
}

/**
 * Real challenge generated + persisted (hashed only) on the caller's OWN
 * contact. Delivery is honestly reported as unavailable — no real vendor
 * is integrated in this deployment (spec: never fabricate verification,
 * never claim a code was sent when it wasn't).
 */
export function requestVerification(user: GovernedUser, contactId: string): VerificationRequestResult {
  const row = requireOwnContact(user, contactId);
  if (!row.enabled) throw new ContactDisabledError('لا يمكن طلب توثيق جهة اتصال معطّلة.');

  const code = generateVerificationCode();
  const codeHash = hashVerificationCode(code);
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  userContactRepository.update(row.id, { verificationCodeHash: codeHash, verificationExpiresAt: expiresAt });

  return {
    status: 'PENDING',
    channel: row.channel as ContactChannel,
    expiresAt: expiresAt.toISOString(),
    delivered: false,
    message: 'تم إنشاء طلب توثيق، لكن لا يوجد مزود توثيق فعلي متصل في هذه البيئة — لم يتم إرسال أي رمز فعلي.',
  };
}

/**
 * Succeeds only against a real, unexpired, previously-requested challenge
 * for this exact contact. Idempotent if the contact is already verified
 * (regardless of the supplied code) — confirming twice is a safe no-op,
 * the same idempotency discipline the rest of this codebase already
 * applies to notification delivery and telemetry ingestion.
 */
export function confirmVerification(user: GovernedUser, contactId: string, code: unknown): ContactView {
  const row = requireOwnContact(user, contactId);

  if (row.verifiedAt) {
    return toView(row);
  }
  if (!row.enabled) {
    throw new ContactDisabledError('لا يمكن توثيق جهة اتصال معطّلة.');
  }
  if (typeof code !== 'string' || code.length === 0) {
    throw new InvalidVerificationCodeError('رمز التوثيق مطلوب.');
  }
  if (!row.verificationCodeHash || !row.verificationExpiresAt || row.verificationExpiresAt.getTime() < Date.now()) {
    throw new VerificationUnavailableError('لا يوجد طلب توثيق فعّال لهذه الجهة — الرجاء طلب توثيق جديد.');
  }
  if (!verifyVerificationCode(code, row.verificationCodeHash)) {
    throw new InvalidVerificationCodeError('رمز التوثيق غير صحيح.');
  }

  userContactRepository.update(row.id, { verifiedAt: new Date(), verificationCodeHash: null, verificationExpiresAt: null });
  return toView(userContactRepository.findById(row.id)! as ContactRow);
}
