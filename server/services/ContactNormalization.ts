import type { ContactChannel } from '../domain/contactContract';

// Phase 6A — deterministic, channel-specific normalization + masking. Pure
// functions only: no DB access, no side effects. Every rule here is
// intentionally conservative (spec §7: "do not silently transform ambiguous
// numbers into potentially incorrect identities") — an input that doesn't
// already look correct is rejected, never guessed at.

export class ContactValidationError extends Error {}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // basic syntactic check only (spec §11), not a full RFC 5322 parser
const MAX_EMAIL_LENGTH = 320;
const MAX_PUSH_TOKEN_LENGTH = 4096;
// Seed/test data (drivers.phone, students.parentPhone) is Omani-format
// "+968 XXXX XXXX" — a real 11-digit E.164 number. This range (7-15 digits
// after the leading '+') is the general E.164 bound, not an Oman-specific
// assumption, and no country code is ever inferred or defaulted.
const MIN_SMS_DIGITS = 7;
const MAX_SMS_DIGITS = 15;

export interface NormalizedContact {
  /** The value as stored — trimmed, channel-appropriate casing/shape. */
  value: string;
  /** The deterministic lookup/dedup form — what the UNIQUE(userId, channel, normalizedValue) constraint compares. */
  normalizedValue: string;
}

/** Validates and normalizes by channel (spec §7/§11). Throws ContactValidationError on anything empty, malformed, oversized, or ambiguous. */
export function normalizeContactValue(channel: ContactChannel, rawValue: unknown): NormalizedContact {
  if (typeof rawValue !== 'string') {
    throw new ContactValidationError('قيمة جهة الاتصال مطلوبة.');
  }
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    throw new ContactValidationError('قيمة جهة الاتصال لا يمكن أن تكون فارغة.');
  }

  switch (channel) {
    case 'EMAIL':
      return normalizeEmail(trimmed);
    case 'SMS':
      return normalizeSms(trimmed);
    case 'PUSH':
      return normalizePushToken(trimmed);
  }
}

function normalizeEmail(trimmed: string): NormalizedContact {
  if (trimmed.length > MAX_EMAIL_LENGTH) {
    throw new ContactValidationError('البريد الإلكتروني طويل جداً.');
  }
  if (!EMAIL_PATTERN.test(trimmed)) {
    throw new ContactValidationError('صيغة البريد الإلكتروني غير صالحة.');
  }
  const lower = trimmed.toLowerCase();
  return { value: trimmed, normalizedValue: lower };
}

/** Requires an already-international-format number (leading '+'). Never adds a default country code, never reinterprets a local-format number — an ambiguous input is a rejection, not a guess. */
function normalizeSms(trimmed: string): NormalizedContact {
  if (!trimmed.startsWith('+')) {
    throw new ContactValidationError('رقم الجوال يجب أن يبدأ بمفتاح الدولة الدولي (مثال: +968...).');
  }
  const digitsOnly = trimmed.slice(1).replace(/[\s()-]/g, '');
  if (digitsOnly.length === 0 || !/^\d+$/.test(digitsOnly)) {
    throw new ContactValidationError('رقم الجوال يجب أن يحتوي على أرقام فقط بعد مفتاح الدولة.');
  }
  if (digitsOnly.length < MIN_SMS_DIGITS || digitsOnly.length > MAX_SMS_DIGITS) {
    throw new ContactValidationError('طول رقم الجوال غير صالح.');
  }
  const normalized = `+${digitsOnly}`;
  return { value: normalized, normalizedValue: normalized };
}

/** Opaque — never interpreted, never re-cased (spec §7: "treat the push token as an opaque value"). */
function normalizePushToken(trimmed: string): NormalizedContact {
  if (trimmed.length > MAX_PUSH_TOKEN_LENGTH) {
    throw new ContactValidationError('رمز الإشعارات الفورية طويل جداً.');
  }
  return { value: trimmed, normalizedValue: trimmed };
}

// ---------------------------------------------------------------------------
// Masking (spec §6) — deterministic, tested, never exposes the raw value.
// ---------------------------------------------------------------------------

export function maskContactValue(channel: ContactChannel, value: string): string {
  switch (channel) {
    case 'EMAIL':
      return maskEmail(value);
    case 'SMS':
      return maskPhone(value);
    case 'PUSH':
      // Presence-only, per spec's own example ("PUSH: registered /
      // unregistered") — the raw token is never returned, not even masked.
      return 'مسجّل';
  }
}

function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at <= 0) return '***';
  const local = value.slice(0, at);
  const domain = value.slice(at);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***${domain}`;
}

function maskPhone(value: string): string {
  // value is always the normalized "+<digits>" form by the time this runs.
  const digits = value.slice(1);
  if (digits.length <= 6) {
    return `+${digits.slice(0, 1)}${'*'.repeat(Math.max(1, digits.length - 1))}`;
  }
  const prefix = digits.slice(0, 3);
  const suffix = digits.slice(-3);
  const starCount = Math.max(3, digits.length - 6);
  return `+${prefix}${'*'.repeat(starCount)}${suffix}`;
}
