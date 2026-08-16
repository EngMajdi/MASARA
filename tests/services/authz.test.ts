import { describe, it, expect } from 'vitest';
import { requireOperationalUser } from '../../server/services/authz';
import { userRepository } from '../../server/repositories/userRepository';

describe('requireOperationalUser (shared authz guard, spec Phase 2B §16/§43)', () => {
  it('allows an admin', () => {
    const admin = userRepository.findAll().find((u) => u.role === 'admin')!;
    const guard = requireOperationalUser(admin.email);
    expect(guard.ok).toBe(true);
  });

  it('allows a school operator', () => {
    const school = userRepository.findAll().find((u) => u.role === 'school')!;
    const guard = requireOperationalUser(school.email);
    expect(guard.ok).toBe(true);
  });

  it('rejects a driver — 403', () => {
    const driver = userRepository.findAll().find((u) => u.role === 'driver')!;
    const guard = requireOperationalUser(driver.email);
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(403);
  });

  it('rejects a missing email — 400', () => {
    const guard = requireOperationalUser(undefined);
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(400);
  });

  it('rejects an unknown email — 404', () => {
    const guard = requireOperationalUser('nobody@masara.om');
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(404);
  });
});
