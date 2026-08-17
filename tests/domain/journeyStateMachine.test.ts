import { describe, it, expect } from 'vitest';
import {
  canTransitionJourney,
  assertJourneyTransition,
  isJourneyTerminal,
  InvalidJourneyTransitionError,
} from '../../server/domain/JourneyStateMachine';

describe('JourneyStateMachine (spec Phase 3A §9/§10, AC-04/05/06)', () => {
  it('allows every documented happy-path transition', () => {
    expect(canTransitionJourney('scheduled', 'waiting')).toBe(true);
    expect(canTransitionJourney('waiting', 'boarding')).toBe(true);
    expect(canTransitionJourney('boarding', 'on_bus')).toBe(true);
    expect(canTransitionJourney('on_bus', 'in_transit')).toBe(true);
    expect(canTransitionJourney('in_transit', 'approaching_stop')).toBe(true);
    expect(canTransitionJourney('approaching_stop', 'dropped_off')).toBe(true);
    expect(canTransitionJourney('dropped_off', 'completed')).toBe(true);
  });

  it('allows the documented exceptional branches', () => {
    expect(canTransitionJourney('scheduled', 'cancelled')).toBe(true);
    expect(canTransitionJourney('waiting', 'cancelled')).toBe(true);
    expect(canTransitionJourney('waiting', 'missed')).toBe(true);
    expect(canTransitionJourney('boarding', 'cancelled')).toBe(true);
    expect(canTransitionJourney('boarding', 'missed')).toBe(true);
    expect(canTransitionJourney('missed', 'cancelled')).toBe(true);
    expect(canTransitionJourney('on_bus', 'incident')).toBe(true);
    expect(canTransitionJourney('in_transit', 'incident')).toBe(true);
    expect(canTransitionJourney('approaching_stop', 'incident')).toBe(true);
  });

  // Spec §10/§52 explicit "must never be allowed" examples.
  it('rejects COMPLETED -> ON_BUS', () => {
    expect(canTransitionJourney('completed', 'on_bus')).toBe(false);
  });

  it('rejects DROPPED_OFF -> BOARDING', () => {
    expect(canTransitionJourney('dropped_off', 'boarding')).toBe(false);
  });

  it('rejects MISSED -> IN_TRANSIT', () => {
    expect(canTransitionJourney('missed', 'in_transit')).toBe(false);
  });

  it('rejects CANCELLED -> BOARDING', () => {
    expect(canTransitionJourney('cancelled', 'boarding')).toBe(false);
  });

  it('rejects a missed journey silently reopening to on_bus (spec §64)', () => {
    expect(canTransitionJourney('missed', 'on_bus')).toBe(false);
    expect(canTransitionJourney('missed', 'boarding')).toBe(false);
    expect(canTransitionJourney('missed', 'waiting')).toBe(false);
  });

  it('rejects cancelling a journey that is actively under way', () => {
    expect(canTransitionJourney('on_bus', 'cancelled')).toBe(false);
    expect(canTransitionJourney('in_transit', 'cancelled')).toBe(false);
    expect(canTransitionJourney('approaching_stop', 'cancelled')).toBe(false);
  });

  it('assertJourneyTransition throws InvalidJourneyTransitionError on an illegal move', () => {
    expect(() => assertJourneyTransition('completed', 'boarding')).toThrow(InvalidJourneyTransitionError);
  });

  it('assertJourneyTransition is a no-op on a legal move', () => {
    expect(() => assertJourneyTransition('scheduled', 'waiting')).not.toThrow();
  });

  it('completed, cancelled, and incident are terminal', () => {
    expect(isJourneyTerminal('completed')).toBe(true);
    expect(isJourneyTerminal('cancelled')).toBe(true);
    expect(isJourneyTerminal('incident')).toBe(true);
  });

  it('missed is NOT fully terminal — the one deliberate cancel-follow-up stays open', () => {
    expect(isJourneyTerminal('missed')).toBe(false);
    expect(canTransitionJourney('missed', 'cancelled')).toBe(true);
  });

  it('scheduled/waiting/boarding/on_bus/in_transit/approaching_stop/dropped_off are non-terminal', () => {
    for (const state of ['scheduled', 'waiting', 'boarding', 'on_bus', 'in_transit', 'approaching_stop', 'dropped_off'] as const) {
      expect(isJourneyTerminal(state)).toBe(false);
    }
  });
});
