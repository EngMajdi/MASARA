// Generic transition-graph engine — the ONE state-machine abstraction shared
// by every domain lifecycle in MASARA (spec Phase 3A §74: do not create a
// parallel JourneyStateMachine framework). Domain-specific graphs (like the
// Recommendation lifecycle below, or server/domain/JourneyStateMachine.ts)
// only need to supply their transition table — the engine itself is shared.
//
// Nothing outside a domain's own module decides whether a transition is
// legal — UI button visibility is not a security boundary, this is.

export type TransitionGraph<T extends string> = Record<T, readonly T[]>;

export interface DomainStateMachine<T extends string> {
  canTransition(from: T, to: T): boolean;
  assertTransition(from: T, to: T): void;
  isTerminal(state: T): boolean;
  InvalidTransitionError: new (from: T, to: T) => Error & { from: T; to: T };
}

export function createStateMachine<T extends string>(graph: TransitionGraph<T>): DomainStateMachine<T> {
  class InvalidTransitionError extends Error {
    readonly from: T;
    readonly to: T;
    constructor(from: T, to: T) {
      super(`لا يمكن الانتقال من الحالة "${from}" إلى "${to}".`);
      this.from = from;
      this.to = to;
    }
  }

  function canTransition(from: T, to: T): boolean {
    return graph[from]?.includes(to) ?? false;
  }

  function assertTransition(from: T, to: T): void {
    if (!canTransition(from, to)) {
      throw new InvalidTransitionError(from, to);
    }
  }

  function isTerminal(state: T): boolean {
    return graph[state].length === 0;
  }

  return { canTransition, assertTransition, isTerminal, InvalidTransitionError };
}

// ---------------------------------------------------------------------------
// Recommendation lifecycle (Phase 2A) — behavior-identical to before the
// Phase 3A refactor. Every export below has the same name and signature.
// ---------------------------------------------------------------------------

export type RecommendationStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'executed'
  | 'execution_failed'
  | 'verified'
  | 'verification_failed';

const RECOMMENDATION_TRANSITIONS: TransitionGraph<RecommendationStatus> = {
  pending: ['approved', 'rejected', 'expired', 'cancelled'],
  approved: ['executed', 'execution_failed'],
  rejected: [],
  expired: [],
  cancelled: [],
  executed: ['verified', 'verification_failed'],
  execution_failed: [],
  verified: [],
  verification_failed: [],
};

const recommendationMachine = createStateMachine(RECOMMENDATION_TRANSITIONS);

export const canTransition = recommendationMachine.canTransition;
export const assertTransition = recommendationMachine.assertTransition;
export const isTerminal = recommendationMachine.isTerminal;
export const InvalidStateTransitionError = recommendationMachine.InvalidTransitionError;
