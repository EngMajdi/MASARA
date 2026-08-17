import { createStateMachine, type TransitionGraph } from './StateMachine';

// Domain-specific transition graph only — the engine itself is shared with
// the Recommendation lifecycle via createStateMachine() (spec Phase 3A §74).
//
// A Trip is the shared vehicle run; a Journey is one student's individual
// state within it (spec §7). This graph reconciles spec §9's "happy path"
// chain with §10's branch points into one consistent graph:
//
//   scheduled -> waiting -> boarding -> on_bus -> in_transit
//             -> approaching_stop -> dropped_off -> completed
//
//   cancelled reachable only before the student is physically on the bus
//   (scheduled/waiting/boarding), or as a deliberate follow-up to a missed
//   journey — never once a journey is actively under way or already done.
//
//   missed reachable only from waiting/boarding (being "missed" doesn't mean
//   anything once already on the bus) and is terminal except for an explicit
//   admin cancel — no silent reopening to on_bus (spec §64).
//
//   incident reachable from any state where the student is physically with
//   the bus (on_bus/in_transit/approaching_stop) and is terminal in this
//   phase — Journey Core only records that it happened; it does not define
//   a recovery workflow, and it does not duplicate the existing AI safety
//   escalation (spec §29/§75, that stays entirely in PredictionEngine/Agent).
export type JourneyState =
  | 'scheduled'
  | 'waiting'
  | 'boarding'
  | 'on_bus'
  | 'in_transit'
  | 'approaching_stop'
  | 'dropped_off'
  | 'completed'
  | 'cancelled'
  | 'missed'
  | 'incident';

const JOURNEY_TRANSITIONS: TransitionGraph<JourneyState> = {
  scheduled: ['waiting', 'cancelled'],
  waiting: ['boarding', 'missed', 'cancelled'],
  boarding: ['on_bus', 'missed', 'cancelled'],
  on_bus: ['in_transit', 'incident'],
  in_transit: ['approaching_stop', 'incident'],
  approaching_stop: ['dropped_off', 'incident'],
  dropped_off: ['completed'],
  completed: [],
  cancelled: [],
  missed: ['cancelled'],
  incident: [],
};

const journeyMachine = createStateMachine(JOURNEY_TRANSITIONS);

export const canTransitionJourney = journeyMachine.canTransition;
export const assertJourneyTransition = journeyMachine.assertTransition;
export const isJourneyTerminal = journeyMachine.isTerminal;
export const InvalidJourneyTransitionError = journeyMachine.InvalidTransitionError;

// One event type per transition target — matches spec §14's minimum list
// exactly, no unnecessary event explosion. JOURNEY_CREATED is emitted at
// creation time (not a transition), the rest map onto `newState`.
export const JOURNEY_EVENT_TYPE_FOR_STATE: Record<JourneyState, string> = {
  scheduled: 'JOURNEY_CREATED',
  waiting: 'JOURNEY_STARTED',
  boarding: 'BOARDING_STARTED',
  on_bus: 'STUDENT_BOARDED',
  in_transit: 'TRANSIT_STARTED',
  approaching_stop: 'STOP_APPROACHING',
  dropped_off: 'STUDENT_DROPPED_OFF',
  completed: 'JOURNEY_COMPLETED',
  cancelled: 'JOURNEY_CANCELLED',
  missed: 'STUDENT_MISSED',
  incident: 'JOURNEY_INCIDENT',
};
