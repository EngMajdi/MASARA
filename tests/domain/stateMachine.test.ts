import { describe, it, expect } from 'vitest';
import { canTransition, assertTransition, isTerminal, InvalidStateTransitionError } from '../../server/domain/StateMachine';

describe('StateMachine (spec Phase 2A §17, AC-15)', () => {
  it('allows every documented legal transition', () => {
    expect(canTransition('pending', 'approved')).toBe(true);
    expect(canTransition('pending', 'rejected')).toBe(true);
    expect(canTransition('pending', 'expired')).toBe(true);
    expect(canTransition('pending', 'cancelled')).toBe(true);
    expect(canTransition('approved', 'executed')).toBe(true);
    expect(canTransition('approved', 'execution_failed')).toBe(true);
    expect(canTransition('executed', 'verified')).toBe(true);
    expect(canTransition('executed', 'verification_failed')).toBe(true);
  });

  it('rejects REJECTED -> APPROVED', () => {
    expect(canTransition('rejected', 'approved')).toBe(false);
  });

  it('rejects VERIFIED -> APPROVED', () => {
    expect(canTransition('verified', 'approved')).toBe(false);
  });

  it('rejects skipping straight from pending to executed', () => {
    expect(canTransition('pending', 'executed')).toBe(false);
  });

  it('rejects re-entering pending from any state', () => {
    for (const from of ['approved', 'rejected', 'expired', 'cancelled', 'executed', 'verified'] as const) {
      expect(canTransition(from, 'pending')).toBe(false);
    }
  });

  it('assertTransition throws InvalidStateTransitionError on an illegal move', () => {
    expect(() => assertTransition('rejected', 'approved')).toThrow(InvalidStateTransitionError);
  });

  it('assertTransition is a no-op on a legal move', () => {
    expect(() => assertTransition('pending', 'approved')).not.toThrow();
  });

  it('terminal states have no outgoing transitions', () => {
    for (const status of ['rejected', 'expired', 'cancelled', 'execution_failed', 'verified', 'verification_failed'] as const) {
      expect(isTerminal(status)).toBe(true);
    }
    expect(isTerminal('pending')).toBe(false);
    expect(isTerminal('approved')).toBe(false);
    expect(isTerminal('executed')).toBe(false);
  });
});
