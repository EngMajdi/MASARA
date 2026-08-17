// Phase 3C — Future Telemetry Contract (Phase 4 design-time only).
//
// Nothing in this file is wired to any route, repository, or database table.
// There is no `telemetry`/`locations`/`gps_points` table, no POST endpoint,
// no ingestion pipeline. This file exists so Phase 4 has a single, reviewed
// starting contract instead of inventing telemetry shapes ad hoc once GPS
// work begins — it is documentation expressed as TypeScript types (spec
// §60/§61: "create internal TypeScript types... only if they fit the
// existing architecture", and §72: "when uncertain between adding an
// abstraction now and documenting the requirement for Phase 4, prefer
// documenting").
//
// ---------------------------------------------------------------------------
// 1. TELEMETRY IS NOT STATE (spec §14/§18/§41/§42)
// ---------------------------------------------------------------------------
// A location observation is a fact about the physical world, never a Journey
// or Trip state transition. "Bus at coordinate X,Y" must never be allowed to
// imply "Journey = IN_TRANSIT" or "Trip = completed" by itself. Only the
// existing governed paths mutate Journey state (JourneyService's named
// transition functions) and Trip/Bus state (SimulationEngine's step handlers
// today; a future TelemetryIngestion service must NOT gain direct write
// access to `journeys` — if telemetry needs to ever influence Journey state,
// that must go through a new, explicit, reviewed domain decision — e.g. a
// recommendation — never a direct mutation from the ingestion path.
//
// ---------------------------------------------------------------------------
// 2. occurredAt vs receivedAt (spec §16/§17)
// ---------------------------------------------------------------------------
// Every table in the current schema (audit_logs, journeys, boarding_events,
// trips, ...) has exactly ONE timestamp per fact: `createdAt` (or a
// domain-specific column like `boardedAt`), always written server-side at
// the moment the write happens (see server/services/JourneyService.ts —
// "Server-side ... only — never trusts a client-supplied timestamp"). For
// every event Phase 1-3B produces, the moment it happened and the moment
// MASARA recorded it are the same instant, so one timestamp has always been
// enough. This stops being true for telemetry: a GPS device may report
// occurredAt=07:02:10 but not reach MASARA until receivedAt=07:02:13 (or,
// on a flaky connection, minutes later). A future telemetry store MUST keep
// both fields distinct. This is a genuine, documented limitation of the
// current schema — audit_logs has no receivedAt-equivalent column, and
// Phase 3C does not add one, because nothing needs it until real telemetry
// ingestion exists (spec §37: no schema change without a concrete need).
//
// ---------------------------------------------------------------------------
// 3. Ordering (spec §17/§19)
// ---------------------------------------------------------------------------
// Database insertion order (and therefore audit_logs.createdAt order) is
// NOT the same as real-world event order once telemetry can arrive late.
// occurredAt determines "when it happened"; receivedAt/insertion order only
// determines "when MASARA found out". A future telemetry consumer that
// needs correct time-ordering must sort by occurredAt, not by row id or
// receivedAt. Operational Journey events are NOT subject to this problem —
// they are written synchronously by the same request that caused them, so
// their insertion order is already their real order. Out-of-order telemetry
// must never reorder or retroactively rewrite Journey state.
//
// ---------------------------------------------------------------------------
// 4. Idempotency (spec §18)
// ---------------------------------------------------------------------------
// A real device/provider will resend observations (retries, at-least-once
// delivery). `sourceEventId` below is the provider's own identifier for one
// observation; a future ingestion service must treat two observations with
// the same (source, sourceEventId) pair as the same fact, not two. No
// current table has an equivalent uniqueness guard for telemetry because no
// telemetry exists yet — journeys.journeys_student_trip_unique is the
// existing example of the same pattern (a real DB constraint, not just
// application logic) that a future telemetry table should follow.
//
// ---------------------------------------------------------------------------
// 5. Append-only (spec §13/§20)
// ---------------------------------------------------------------------------
// Observations must be inserted, never updated in place — exactly like
// audit_logs and boarding_events today (no UPDATE/DELETE route exists for
// either). A "current bus location" is a separate, derived READ MODEL
// projected from the observation history, not the history itself (spec
// §46) — do not conflate the two into one table.
//
// ---------------------------------------------------------------------------
// 6. Trust boundary (spec §51/§52/§53)
// ---------------------------------------------------------------------------
// Telemetry is untrusted external input until authenticated, validated, and
// correlated — the same posture MASARA already takes with client-submitted
// identity today (JourneyService never trusts a client-supplied driverId;
// authz.ts always re-resolves identity server-side from the authenticated
// email). A future device/provider must be authenticated before its
// observations are accepted; a device must not be able to claim to be
// BUS-02 without proving it. Device timestamps must not be trusted blindly
// either — clock skew, and even future timestamps, must be handled by a
// future ingestion service; Phase 3C does not implement clock correction.
//
// ---------------------------------------------------------------------------
// 7. Failure isolation (spec §56)
// ---------------------------------------------------------------------------
// A telemetry provider outage must never automatically flip Journey or Trip
// state (e.g. auto-marking incident because GPS stopped reporting). That
// remains a distinct, explicit domain decision if it is ever wanted — never
// an automatic side effect of ingestion failure.

import type { EventSource } from './eventTaxonomy';

/**
 * One raw location observation from a physical system. FUTURE CONTRACT ONLY
 * — no table, no producer. Minimum fields are what any provider can
 * realistically be expected to supply; everything else is optional
 * enrichment a richer provider may include (spec §15).
 */
export interface TelemetryObservation {
  // --- Identity & idempotency (required minimum) ---
  sourceEventId: string; // the provider's own event id — see idempotency note above
  source: Extract<EventSource, 'DEVICE' | 'GPS_PROVIDER' | 'SIMULATION'>; // never a real driver/school/admin source
  busId: string; // correlates to the existing `buses` table — Trip stays authoritative for bus/route/driver (spec §11/§14)

  // --- Time (required minimum — see occurredAt vs receivedAt above) ---
  occurredAt: Date; // when the device says it happened — untrusted until validated
  receivedAt: Date; // when MASARA's ingestion actually received it — always server-set, always trustworthy

  // --- Location (required minimum) ---
  latitude: number;
  longitude: number;

  // --- Optional enrichment (do not require — spec §15) ---
  accuracy?: number;
  speed?: number;
  heading?: number;
}

/**
 * Correlates a raw observation to the operational domain it describes.
 * Trip remains authoritative for bus/route/driver; Journey remains
 * authoritative for student-trip state (spec §11) — this type only ever
 * carries IDs, never duplicates those relationships (spec §10/§11).
 */
export interface TelemetryCorrelation {
  busId: string;
  tripId: string | null; // resolved from the bus's active trip at ingestion time, not supplied by the device
  routeId: string | null;
}
