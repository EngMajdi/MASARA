import { telemetryDeviceRepository } from '../repositories/telemetryDeviceRepository';
import { busRepository } from '../repositories/busRepository';
import { generateDeviceSecret, hashDeviceSecret } from './deviceCredentials';

// The controlled path for device lifecycle (spec §92 — device creation must
// not be public; only admin/school, enforced by the route layer via
// requireOperationalUser). Simple guarded status transitions are used
// directly here rather than the shared createStateMachine factory — a
// 3-value, mostly-terminal device lifecycle (active -> disabled|revoked,
// revoked is terminal) doesn't warrant the same generic transition-graph
// abstraction Journey/Recommendation genuinely need; introducing it here
// would be exactly the kind of speculative infrastructure the project has
// repeatedly been told to avoid.

export type DeviceStatus = 'active' | 'disabled' | 'revoked';
export type DeviceProviderType = 'DEVICE' | 'GPS_PROVIDER';

export class DeviceNotFoundError extends Error {}
export class DeviceValidationError extends Error {}
export class DeviceStateError extends Error {}

type DeviceRow = NonNullable<ReturnType<typeof telemetryDeviceRepository.findById>>;

/** The public device shape — secretHash is NEVER included (spec §46). */
export interface PublicDevice {
  id: string;
  busId: string;
  providerType: string;
  status: string;
  label: string;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toPublicDevice(row: DeviceRow): PublicDevice {
  return {
    id: row.id,
    busId: row.busId,
    providerType: row.providerType,
    status: row.status,
    label: row.label,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function requireDevice(id: string): DeviceRow {
  const device = telemetryDeviceRepository.findById(id);
  if (!device) throw new DeviceNotFoundError('الجهاز غير موجود.');
  return device;
}

/**
 * Registers a device against a real, existing Bus. Never against a Bus that
 * doesn't exist (spec §52 — no auto-creation). The raw secret is returned
 * exactly once, here, and never again — no GET ever includes it (spec §46).
 */
export function registerDevice(
  busId: string,
  label: string,
  providerType: DeviceProviderType
): { device: PublicDevice; secret: string } {
  if (!busId) throw new DeviceValidationError('busId مطلوب.');
  if (!label || !label.trim()) throw new DeviceValidationError('اسم الجهاز (label) مطلوب.');
  if (providerType !== 'DEVICE' && providerType !== 'GPS_PROVIDER') {
    // Explicitly excludes 'SIMULATION' — the simulator is never registered
    // as a physical device (spec §42).
    throw new DeviceValidationError(`نوع مزوّد غير صالح: "${providerType}".`);
  }
  const bus = busRepository.findById(busId);
  if (!bus) throw new DeviceValidationError('الحافلة المحددة غير موجودة.');

  const secret = generateDeviceSecret();
  const row = telemetryDeviceRepository.create({
    busId,
    label: label.trim(),
    providerType,
    status: 'active',
    secretHash: hashDeviceSecret(secret),
  });
  return { device: toPublicDevice(telemetryDeviceRepository.findById(row.id)!), secret };
}

export function getDevice(id: string): PublicDevice {
  return toPublicDevice(requireDevice(id));
}

export function listDevices(): PublicDevice[] {
  return telemetryDeviceRepository.findAll().map(toPublicDevice);
}

export function disableDevice(id: string): PublicDevice {
  const device = requireDevice(id);
  if (device.status === 'revoked') throw new DeviceStateError('لا يمكن تعطيل جهاز تم إلغاؤه بالفعل.');
  if (device.status === 'disabled') throw new DeviceStateError('الجهاز معطّل بالفعل.');
  telemetryDeviceRepository.update(id, { status: 'disabled' });
  return toPublicDevice(requireDevice(id));
}

/** Terminal — a revoked device can never be reactivated (spec §44, matching the read-only prototype scope). */
export function revokeDevice(id: string): PublicDevice {
  const device = requireDevice(id);
  if (device.status === 'revoked') throw new DeviceStateError('الجهاز مُلغى بالفعل.');
  telemetryDeviceRepository.update(id, { status: 'revoked' });
  return toPublicDevice(requireDevice(id));
}
