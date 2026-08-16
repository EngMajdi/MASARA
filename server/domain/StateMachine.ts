// Explicit state machine for ai_recommendations.status (spec Phase 2A §17).
// Nothing outside this module decides whether a transition is legal — UI
// button visibility is not a security boundary, this is.

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

const TRANSITIONS: Record<RecommendationStatus, readonly RecommendationStatus[]> = {
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

export class InvalidStateTransitionError extends Error {
  readonly from: RecommendationStatus;
  readonly to: RecommendationStatus;
  constructor(from: RecommendationStatus, to: RecommendationStatus) {
    super(`لا يمكن الانتقال من الحالة "${from}" إلى "${to}".`);
    this.from = from;
    this.to = to;
  }
}

export function canTransition(from: RecommendationStatus, to: RecommendationStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: RecommendationStatus, to: RecommendationStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidStateTransitionError(from, to);
  }
}

export function isTerminal(status: RecommendationStatus): boolean {
  return TRANSITIONS[status].length === 0;
}
