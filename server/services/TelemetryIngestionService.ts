import { telemetryObservationRepository } from '../repositories/telemetryObservationRepository';
import { telemetryDeviceRepository } from '../repositories/telemetryDeviceRepository';
import { tripRepository } from '../repositories/tripRepository';
import { processObservation } from './CurrentLocationProjectionService';
import { captureEtaAccuracySnapshot } from './EtaAccuracyService';
import type { TelemetryObservation } from '../domain/telemetryContract';

// THE telemetry ingestion boundary (spec Phase 4B §1/§124). This is the one
// place an external observation is validated, correlated, and persisted —
// mirroring JourneyService's role as "the one controlled path" for its own
// domain. It imports NO JourneyService function and mutates NO table other
// than telemetry_observations (and telemetry_devices.lastSeenAt, pure
// bookkeeping) — the central rule (telemetry is never a command) is
// enforced by simple absence, exactly like GpsSimulationEngine.

export class TelemetryValidationError extends Error {}
export class TelemetryCorrelationError extends Error {}
export class TelemetryNotFoundError extends Error {}
export class TelemetryConflictError extends Error {}

/** The authenticated device identity resolved by requireTelemetryDevice — never trust anything else for busId/source. */
export interface AuthenticatedDevice {
  id: string;
  busId: string;
  providerType: 'DEVICE' | 'GPS_PROVIDER';
}

/**
 * The WIRE payload a device submits — deliberately a separate, smaller type
 * from the canonical TelemetryObservation (spec §3/§14): it has no
 * observationId (server-assigned), no source (server-derived from the
 * authenticated device, never client-controlled), no receivedAt (always
 * server `now`), and busId/tripId here are CLAIMS to be verified against
 * the device's server-side association, never trusted identity.
 */
export interface TelemetryIngestionPayload {
  sourceEventId: unknown;
  busId?: unknown;
  tripId?: unknown;
  occurredAt: unknown;
  latitude: unknown;
  longitude: unknown;
  speedKmh?: unknown;
  heading?: unknown;
  accuracyMeters?: unknown;
  sequence?: unknown;
}

export type IngestionOutcome = { kind: 'created' | 'duplicate'; observation: TelemetryObservation };

// Configurable, documented, testable (spec §18) — an observation reported
// more than this far in the future is rejected outright. No lower bound:
// genuinely late/delayed telemetry is accepted (spec §20), never silently
// dropped just for being old.
export const FUTURE_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

interface ValidatedPayload {
  sourceEventId: string;
  busId?: string;
  tripId?: string;
  occurredAt: Date;
  latitude: number;
  longitude: number;
  speedKmh?: number;
  heading?: number;
  accuracyMeters?: number;
  sequence?: number;
}

/** Schema validation only (spec §17) — no correlation, no persistence. */
function validatePayload(payload: TelemetryIngestionPayload): ValidatedPayload {
  if (typeof payload.sourceEventId !== 'string' || !payload.sourceEventId.trim()) {
    throw new TelemetryValidationError('sourceEventId مطلوب.');
  }
  if (typeof payload.occurredAt !== 'string' || Number.isNaN(Date.parse(payload.occurredAt))) {
    throw new TelemetryValidationError('occurredAt يجب أن يكون طابعاً زمنياً صالحاً (ISO).');
  }
  if (typeof payload.latitude !== 'number' || !Number.isFinite(payload.latitude) || payload.latitude < -90 || payload.latitude > 90) {
    throw new TelemetryValidationError(`latitude غير صالح: ${payload.latitude}.`);
  }
  if (typeof payload.longitude !== 'number' || !Number.isFinite(payload.longitude) || payload.longitude < -180 || payload.longitude > 180) {
    throw new TelemetryValidationError(`longitude غير صالح: ${payload.longitude}.`);
  }
  if (payload.speedKmh !== undefined && (typeof payload.speedKmh !== 'number' || !Number.isFinite(payload.speedKmh) || payload.speedKmh < 0)) {
    throw new TelemetryValidationError(`speedKmh غير صالح: ${payload.speedKmh}.`);
  }
  if (payload.heading !== undefined && (typeof payload.heading !== 'number' || !Number.isFinite(payload.heading) || payload.heading < 0 || payload.heading >= 360)) {
    throw new TelemetryValidationError(`heading غير صالح: ${payload.heading} (يجب أن يكون 0 <= heading < 360).`);
  }
  if (payload.accuracyMeters !== undefined && (typeof payload.accuracyMeters !== 'number' || !Number.isFinite(payload.accuracyMeters) || payload.accuracyMeters <= 0)) {
    throw new TelemetryValidationError(`accuracyMeters غير صالح: ${payload.accuracyMeters}.`);
  }
  if (payload.sequence !== undefined && (typeof payload.sequence !== 'number' || !Number.isInteger(payload.sequence))) {
    throw new TelemetryValidationError(`sequence غير صالح: ${payload.sequence}.`);
  }
  if (payload.busId !== undefined && typeof payload.busId !== 'string') {
    throw new TelemetryValidationError('busId يجب أن يكون نصاً إن وُجد.');
  }
  if (payload.tripId !== undefined && typeof payload.tripId !== 'string') {
    throw new TelemetryValidationError('tripId يجب أن يكون نصاً إن وُجد.');
  }

  const occurredAt = new Date(payload.occurredAt as string);
  if (occurredAt.getTime() - Date.now() > FUTURE_TOLERANCE_MS) {
    // Temporal validation (spec §18/§19) lives here, not as a separate
    // pass — a future-dated observation is just as invalid as a malformed
    // coordinate; both must fail before persistence is even considered.
    throw new TelemetryValidationError('occurredAt بعيد جداً في المستقبل — تم رفض الرصد.');
  }

  return {
    sourceEventId: payload.sourceEventId,
    busId: payload.busId as string | undefined,
    tripId: payload.tripId as string | undefined,
    occurredAt,
    latitude: payload.latitude,
    longitude: payload.longitude,
    speedKmh: payload.speedKmh as number | undefined,
    heading: payload.heading as number | undefined,
    accuracyMeters: payload.accuracyMeters as number | undefined,
    sequence: payload.sequence as number | undefined,
  };
}

/** Server-authoritative bus/trip correlation (spec §7/§8/§51) — never trusts a client claim without verifying it against the authenticated device. */
function correlate(device: AuthenticatedDevice, validated: ValidatedPayload): { busId: string; tripId: string | null } {
  if (validated.busId !== undefined && validated.busId !== device.busId) {
    // A mismatched claim is rejected outright — never "corrected" to the
    // device's real bus and never leaks whether the claimed busId exists
    // at all (spec §52 — reject safely, no enumeration).
    throw new TelemetryCorrelationError('busId المُرسل لا يطابق الحافلة المرتبطة بهذا الجهاز.');
  }
  const busId = device.busId;

  if (validated.tripId !== undefined) {
    const trip = tripRepository.findById(validated.tripId);
    if (!trip) throw new TelemetryNotFoundError('الرحلة (Trip) المحددة غير موجودة.');
    if (trip.busId !== busId) {
      throw new TelemetryCorrelationError('الرحلة المحددة لا تخص الحافلة المرتبطة بهذا الجهاز.');
    }
    return { busId, tripId: trip.id };
  }

  // No tripId supplied — server-side resolution preferred over rejection
  // (spec §8/§51): infer the bus's current active trip if one exists;
  // otherwise this is valid bus-only telemetry (tripId stays null).
  const activeTrip = tripRepository.findByBusId(busId).find((t) => t.status === 'active');
  return { busId, tripId: activeTrip?.id ?? null };
}

function isUniqueConstraintError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/.test(e?.message ?? '');
}

type ObservationRow = ReturnType<typeof telemetryObservationRepository.create>;

function toTelemetryObservation(row: ObservationRow): TelemetryObservation {
  return {
    observationId: row.id,
    sourceEventId: row.sourceEventId,
    source: row.source as TelemetryObservation['source'],
    busId: row.busId,
    tripId: row.tripId ?? null,
    sequence: row.sequence ?? 0,
    occurredAt: row.occurredAt as Date,
    receivedAt: row.receivedAt as Date,
    latitude: row.latitude,
    longitude: row.longitude,
    speed: row.speedKmh ?? undefined,
    heading: row.heading ?? undefined,
    accuracy: row.accuracyMeters ?? undefined,
  };
}

/** Two observations are the "same fact" only if every meaningful field matches (spec §23/§24) — never just the id. */
function isSamePayload(existing: ObservationRow, incoming: ValidatedPayload, correlation: { busId: string; tripId: string | null }): boolean {
  // SQLite integer timestamp columns round to second precision on read, but
  // `incoming.occurredAt` keeps full millisecond precision in memory — a
  // recurring gotcha in this codebase (see SimulationEngine.listSessionEvents)
  // always solved the same way: a sub-second tolerance instead of exact
  // equality, never a real "different time" once actually persisted.
  const occurredAtMatches = Math.abs(existing.occurredAt.getTime() - incoming.occurredAt.getTime()) < 1000;
  return (
    existing.busId === correlation.busId &&
    existing.tripId === correlation.tripId &&
    existing.latitude === incoming.latitude &&
    existing.longitude === incoming.longitude &&
    occurredAtMatches &&
    (existing.speedKmh ?? null) === (incoming.speedKmh ?? null) &&
    (existing.heading ?? null) === (incoming.heading ?? null) &&
    (existing.accuracyMeters ?? null) === (incoming.accuracyMeters ?? null) &&
    (existing.sequence ?? null) === (incoming.sequence ?? null)
  );
}

/**
 * The single entry point every producer (real device or provider) funnels
 * through. Validates -> correlates -> attempts an atomic insert -> on a
 * unique-constraint collision, decides idempotent-duplicate vs. rejected
 * conflict by comparing the actual stored fields (spec §22/§23/§24, AC-16
 * through AC-20). The original row is NEVER mutated by this function —
 * there is no UPDATE path here at all.
 */
export function ingestObservation(device: AuthenticatedDevice, payload: TelemetryIngestionPayload): IngestionOutcome {
  const validated = validatePayload(payload);
  const correlation = correlate(device, validated);

  try {
    const created = telemetryObservationRepository.create({
      sourceEventId: validated.sourceEventId,
      deviceId: device.id,
      busId: correlation.busId,
      tripId: correlation.tripId,
      source: device.providerType,
      eventType: 'GPS_LOCATION_RECEIVED',
      occurredAt: validated.occurredAt,
      receivedAt: new Date(), // server-controlled — never accepted from the client (spec §4/§67)
      latitude: validated.latitude,
      longitude: validated.longitude,
      speedKmh: validated.speedKmh ?? null,
      heading: validated.heading ?? null,
      accuracyMeters: validated.accuracyMeters ?? null,
      sequence: validated.sequence ?? null,
    });
    telemetryDeviceRepository.update(device.id, { lastSeenAt: new Date() });
    const observation = toTelemetryObservation(created);
    // Phase 4C — downstream, best-effort projection hook (spec §7/§20). The
    // authoritative write to telemetry_observations above is already
    // complete; this can never fail the ingestion itself (see
    // CurrentLocationProjectionService.processObservation's own doc comment).
    processObservation(observation);
    // Phase 4E — best-effort ETA accuracy snapshot, same non-blocking
    // contract as processObservation above (never throws, never fails ingestion).
    captureEtaAccuracySnapshot(observation.busId);
    return { kind: 'created', observation };
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;

    // The database rejected this as a duplicate (deviceId, sourceEventId)
    // pair — this is the real, race-safe defense (spec §26/§58), not an
    // app-level check-then-insert. Decide idempotent vs. conflicting by
    // comparing what's actually stored.
    const existing = telemetryObservationRepository.findByDeviceAndSourceEventId(device.id, validated.sourceEventId);
    if (!existing) throw err; // should be unreachable — the constraint that just fired guarantees a row exists

    if (isSamePayload(existing, validated, correlation)) {
      const observation = toTelemetryObservation(existing);
      processObservation(observation); // idempotent — re-processing the same observation is always a safe no-op (spec §6/§33)
      captureEtaAccuracySnapshot(observation.busId);
      return { kind: 'duplicate', observation };
    }
    throw new TelemetryConflictError('يوجد رصد GPS آخر بنفس sourceEventId ببيانات مختلفة — تم رفض الطلب دون تعديل السجل الأصلي.');
  }
}
