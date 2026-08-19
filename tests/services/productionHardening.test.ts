import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword, verifyPassword } from '../../server/services/legacyAuthCredentials';

// Phase 6D — production-readiness hardening. Section A/B finding: the
// legacy login store (server.ts) compared plaintext passwords with `===`.
// These are the same scrypt+salt+constant-time-verify pure functions
// deviceCredentials.ts (Phase 4B) and ContactVerificationService.ts
// (Phase 6B) already established — tested here the same way those were.

describe('legacyAuthCredentials — hashPassword/verifyPassword (spec Section A/B mandatory)', () => {
  it('hashPassword never returns the plaintext password', () => {
    const hash = hashPassword('password123');
    expect(hash).not.toBe('password123');
    expect(hash).not.toContain('password123');
  });

  it('hashPassword produces a salt:hash pair — a different salt (and therefore a different hash) each call, even for the same password', () => {
    const a = hashPassword('password123');
    const b = hashPassword('password123');
    expect(a).not.toBe(b);
    expect(a.split(':')).toHaveLength(2);
  });

  it('verifyPassword succeeds for the correct password against its own hash', () => {
    const hash = hashPassword('correct-horse-battery-staple');
    expect(verifyPassword('correct-horse-battery-staple', hash)).toBe(true);
  });

  it('verifyPassword fails for an incorrect password', () => {
    const hash = hashPassword('correct-horse-battery-staple');
    expect(verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('verifyPassword never throws on a malformed stored hash — fails closed', () => {
    expect(() => verifyPassword('anything', 'not-a-real-hash')).not.toThrow();
    expect(verifyPassword('anything', 'not-a-real-hash')).toBe(false);
    expect(verifyPassword('anything', '')).toBe(false);
  });

  it('verifyPassword never throws on an empty candidate password', () => {
    const hash = hashPassword('realpassword');
    expect(() => verifyPassword('', hash)).not.toThrow();
    expect(verifyPassword('', hash)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Source-scan: the plaintext comparison pattern this phase removed must
// never reappear, and the audit-logs resource-safety bound must hold.
// ---------------------------------------------------------------------------

describe('Source-scan — production hardening findings stay fixed (spec Section 5 mandatory)', () => {
  const serverSource = fs.readFileSync(path.resolve(__dirname, '../../server.ts'), 'utf8');
  const agentRoutesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/agentRoutes.ts'), 'utf8');
  const credentialsSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/legacyAuthCredentials.ts'), 'utf8');

  it('server.ts never compares a password with plain string equality', () => {
    expect(serverSource).not.toMatch(/\.password\s*!==\s*password\b/);
    expect(serverSource).not.toMatch(/\.password\s*===\s*password\b/);
  });

  it('server.ts never stores a plaintext `password` field on a user object literal', () => {
    // The legacy seed array and the register handler both construct user
    // objects; neither may assign a bare `password` field, only `passwordHash`.
    expect(serverSource).not.toMatch(/\bpassword:\s*(password|'password123')\b/);
  });

  it('server.ts uses the real hash/verify functions for login and registration', () => {
    expect(serverSource).toMatch(/verifyPassword\(/);
    expect(serverSource).toMatch(/hashPassword\(/);
  });

  it('legacyAuthCredentials.ts never logs a password or hash', () => {
    expect(credentialsSource).not.toMatch(/console\.(log|info|debug)\(/);
  });

  it('legacyAuthCredentials.ts uses a constant-time comparison, never plain string equality, to verify a password', () => {
    expect(credentialsSource).toMatch(/timingSafeEqual/);
  });

  it('/api/audit-logs is bounded — never an unbounded findAll() on an append-only table', () => {
    const block = agentRoutesSource.slice(agentRoutesSource.indexOf("'/api/audit-logs'"), agentRoutesSource.indexOf("'/api/audit-logs'") + 300);
    expect(block).not.toMatch(/auditRepository\.findAll\(\)/);
    expect(block).toMatch(/findFiltered\(\{\s*limit:\s*\d+\s*\}\)/);
  });

  it('server.ts registers process-level unhandledRejection and uncaughtException handlers', () => {
    expect(serverSource).toMatch(/process\.on\(['"]unhandledRejection['"]/);
    expect(serverSource).toMatch(/process\.on\(['"]uncaughtException['"]/);
  });

  it('the health endpoint never exposes a raw SQL error, a connection string, or the DATABASE_URL value', () => {
    const start = serverSource.indexOf("app.get('/api/health'");
    const block = serverSource.slice(start, serverSource.indexOf('});', start));
    expect(block).not.toMatch(/DATABASE_URL/);
    expect(block).not.toMatch(/err\.message|error\.message/);
  });
});
