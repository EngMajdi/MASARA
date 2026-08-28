import { Router, type Response } from 'express';
import {
  registerDevice,
  getDevice,
  listDevices,
  disableDevice,
  revokeDevice,
  DeviceNotFoundError,
  DeviceValidationError,
  DeviceStateError,
  type DeviceProviderType,
} from '../services/TelemetryDeviceService';
import { requireOperationalUser, requireVerifiedEmail } from '../services/authz';

// Device registration/lifecycle (Phase 4B §45/§92) — admin/school only,
// same governed gate as every other operational management surface. A
// driver or parent can never register or manage a device.
//
// Phase 11 SECURITY FIX — identity now comes from a verified session token
// (`requireVerifiedEmail`), never a client-supplied `userEmail` query/body field.
export const deviceRouter = Router();

function handleDeviceError(err: unknown, res: Response) {
  if (err instanceof DeviceNotFoundError) return res.status(404).json({ error: err.message });
  if (err instanceof DeviceValidationError) return res.status(422).json({ error: err.message });
  if (err instanceof DeviceStateError) return res.status(409).json({ error: err.message });
  console.error('Device error:', err);
  return res.status(500).json({ error: 'حدث خطأ غير متوقع في إدارة الأجهزة.' });
}

deviceRouter.get('/api/devices', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(listDevices()); // never includes secretHash (spec §46)
});

deviceRouter.post('/api/devices', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const { busId, label, providerType } = req.body ?? {};
  try {
    const { device, secret } = registerDevice(busId, label, (providerType ?? 'DEVICE') as DeviceProviderType);
    // The raw secret is returned exactly once, here — never again by any
    // other endpoint (spec §46).
    res.json({ success: true, device, secret });
  } catch (err) {
    handleDeviceError(err, res);
  }
});

deviceRouter.get('/api/devices/:id', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  try {
    res.json(getDevice(req.params.id));
  } catch (err) {
    handleDeviceError(err, res);
  }
});

deviceRouter.post('/api/devices/:id/disable', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  try {
    res.json({ success: true, device: disableDevice(req.params.id) });
  } catch (err) {
    handleDeviceError(err, res);
  }
});

deviceRouter.post('/api/devices/:id/revoke', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  try {
    res.json({ success: true, device: revokeDevice(req.params.id) });
  } catch (err) {
    handleDeviceError(err, res);
  }
});
