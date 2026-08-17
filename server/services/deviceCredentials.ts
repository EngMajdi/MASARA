import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Device secret hashing (Phase 4B §9/§11/§46) — same scrypt+salt convention
// already established by database/seed/seed.ts's hashPassword, extended
// with a constant-time verify (seed.ts never needed one, since the legacy
// login layer never actually checks the governed passwordHash column — see
// server/services/authz.ts's join-by-email notes). A device secret is
// never stored, logged, or returned in plaintext anywhere past this file.

/** A fresh random device secret — shown to the caller exactly once, at registration (spec §46). */
export function generateDeviceSecret(): string {
  return randomBytes(32).toString('hex');
}

export function hashDeviceSecret(secret: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(secret, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/** Constant-time comparison (spec §11 "compare securely") — never a plain string `===`. */
export function verifyDeviceSecret(secret: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(secret, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

/**
 * Parses `Authorization: Bearer <deviceId>.<secret>` — the only credential
 * shape this ingestion boundary accepts (spec §12). Returns null on any
 * malformed input rather than throwing, so the caller can respond with one
 * generic 401 regardless of exactly what was wrong (spec §47 — never leak
 * more than necessary about why authentication failed).
 */
export function parseDeviceBearerToken(authorizationHeader: unknown): { deviceId: string; secret: string } | null {
  if (typeof authorizationHeader !== 'string') return null;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/);
  if (!match) return null;
  const token = match[1];
  const dotIndex = token.indexOf('.');
  if (dotIndex <= 0 || dotIndex === token.length - 1) return null;
  const deviceId = token.slice(0, dotIndex);
  const secret = token.slice(dotIndex + 1);
  if (!deviceId || !secret) return null;
  return { deviceId, secret };
}
