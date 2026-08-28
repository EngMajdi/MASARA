import { Router } from 'express';
import { busRepository } from '../repositories/busRepository';
import { driverRepository } from '../repositories/driverRepository';
import { routeRepository } from '../repositories/routeRepository';
import { schoolRepository } from '../repositories/schoolRepository';
import { requireOperationalUser, requireVerifiedEmail } from '../services/authz';
import { createTrip, createBus, assignDriverToBus, TripValidationError } from '../services/FleetProvisioningService';

// Phase 15 — Pilot Hardening: the minimum live fleet-provisioning surface a
// real school needs to run a controlled pilot WITHOUT database
// intervention. Phase 14 closed the account-provisioning gap (parents/
// drivers/students); this file closes the operational-structure gap
// (buses/routes/stops/trips) that Phase 14's own report flagged as
// deliberately out of scope.
//
// Deliberately minimal — this is not a fleet-management product. No trip
// editing, no scheduling engine, no recurring trips. Exactly enough to go
// School -> Route -> Stops -> Bus -> Driver -> Trip -> (students already
// carry busId) -> Journeys auto-appear via the existing, unchanged
// ensureJourneysForTrip.
//
// Every write here is admin/school only (requireOperationalUser, the same
// guard every other governed write endpoint already uses) and every
// validation error is a real, human-readable Arabic message — never a
// raw DB/stack-trace leak.
export const fleetRouter = Router();

function thePilotSchoolId(): string | null {
  return schoolRepository.findAll()[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Buses
// ---------------------------------------------------------------------------

fleetRouter.post('/api/governed/buses', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const { busNumber, plateNumber, capacity } = req.body ?? {};
  if (typeof busNumber !== 'string' || !busNumber.trim()) return res.status(422).json({ error: 'رقم الحافلة مطلوب.' });
  if (typeof plateNumber !== 'string' || !plateNumber.trim()) return res.status(422).json({ error: 'رقم اللوحة مطلوب.' });
  if (typeof capacity !== 'number' || !Number.isFinite(capacity) || capacity <= 0) return res.status(422).json({ error: 'سعة الحافلة يجب أن تكون رقماً أكبر من صفر.' });

  const schoolId = thePilotSchoolId();
  if (!schoolId) return res.status(500).json({ error: 'لا توجد مدرسة مهيأة في النظام.' });

  const bus = createBus({ schoolId, busNumber: busNumber.trim(), plateNumber: plateNumber.trim(), capacity });
  res.json({ success: true, bus });
});

fleetRouter.patch('/api/governed/buses/:id', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const bus = busRepository.findById(req.params.id);
  if (!bus) return res.status(404).json({ error: 'الحافلة غير موجودة.' });

  const { busNumber, plateNumber, capacity, status } = req.body ?? {};
  const changes: Parameters<typeof busRepository.update>[1] = {};
  if (busNumber !== undefined) {
    if (typeof busNumber !== 'string' || !busNumber.trim()) return res.status(422).json({ error: 'رقم الحافلة غير صالح.' });
    changes.busNumber = busNumber.trim();
  }
  if (plateNumber !== undefined) {
    if (typeof plateNumber !== 'string' || !plateNumber.trim()) return res.status(422).json({ error: 'رقم اللوحة غير صالح.' });
    changes.plateNumber = plateNumber.trim();
  }
  if (capacity !== undefined) {
    if (typeof capacity !== 'number' || !Number.isFinite(capacity) || capacity <= 0) return res.status(422).json({ error: 'سعة الحافلة غير صالحة.' });
    changes.capacity = capacity;
  }
  // Reuses the existing documented status enum ('idle'|'en_route_pickup'|
  // 'en_route_school'|'returning'|'maintenance', database/schema.ts) —
  // "تفعيل"/"تعطيل" in the UI map onto 'idle'/'maintenance' rather than
  // inventing a new boolean flag the rest of the GPS/journey pipeline
  // doesn't know about.
  if (status !== undefined) {
    const VALID_STATUSES = new Set(['idle', 'en_route_pickup', 'en_route_school', 'returning', 'maintenance']);
    if (typeof status !== 'string' || !VALID_STATUSES.has(status)) return res.status(422).json({ error: 'حالة الحافلة غير صالحة.' });
    changes.status = status;
  }

  busRepository.update(req.params.id, changes);
  res.json({ success: true, bus: busRepository.findById(req.params.id) });
});

// Assign/unassign a real governed driver to a real governed bus. Never
// trusts a client-supplied driverId as proof of anything beyond "this row
// exists" — the caller must already be an authorized operational user.
fleetRouter.patch('/api/governed/buses/:id/assign-driver', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const bus = busRepository.findById(req.params.id);
  if (!bus) return res.status(404).json({ error: 'الحافلة غير موجودة.' });

  const { driverId } = req.body ?? {};
  if (driverId !== null) {
    if (typeof driverId !== 'string' || !driverId) return res.status(422).json({ error: 'معرّف السائق غير صالح.' });
    if (!driverRepository.findById(driverId)) return res.status(422).json({ error: 'يجب أن يشير معرّف السائق إلى سائق حقيقي في النظام.' });
  }

  assignDriverToBus(req.params.id, driverId);
  res.json({ success: true, bus: busRepository.findById(req.params.id) });
});

fleetRouter.get('/api/governed/drivers', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(driverRepository.findAll());
});

// ---------------------------------------------------------------------------
// Routes + stops
// ---------------------------------------------------------------------------

fleetRouter.post('/api/governed/routes', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const { name } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) return res.status(422).json({ error: 'اسم المسار مطلوب.' });

  const schoolId = thePilotSchoolId();
  if (!schoolId) return res.status(500).json({ error: 'لا توجد مدرسة مهيأة في النظام.' });

  const route = routeRepository.create({ schoolId, name: name.trim(), totalDistanceKm: 0, estimatedDurationMins: 0, status: 'scheduled' });
  res.json({ success: true, route });
});

fleetRouter.patch('/api/governed/routes/:id', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const route = routeRepository.findById(req.params.id);
  if (!route) return res.status(404).json({ error: 'المسار غير موجود.' });

  const { name, status } = req.body ?? {};
  const changes: Parameters<typeof routeRepository.update>[1] = {};
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) return res.status(422).json({ error: 'اسم المسار غير صالح.' });
    changes.name = name.trim();
  }
  if (status !== undefined) {
    const VALID_STATUSES = new Set(['active', 'scheduled', 'completed', 'rerouted']);
    if (typeof status !== 'string' || !VALID_STATUSES.has(status)) return res.status(422).json({ error: 'حالة المسار غير صالحة.' });
    changes.status = status;
  }

  routeRepository.update(req.params.id, changes);
  res.json({ success: true, route: routeRepository.findById(req.params.id) });
});

function isValidCoordinate(lat: unknown, lng: unknown): lat is number {
  return typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90 && typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

// Never fabricates a coordinate: rejects (422) rather than defaulting to
// 0,0 or any other placeholder if the caller didn't supply a real one.
fleetRouter.post('/api/governed/routes/:id/stops', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const route = routeRepository.findById(req.params.id);
  if (!route) return res.status(404).json({ error: 'المسار غير موجود.' });

  const { name, lat, lng } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) return res.status(422).json({ error: 'اسم نقطة التوقف مطلوب.' });
  if (!isValidCoordinate(lat, lng)) return res.status(422).json({ error: 'إحداثيات نقطة التوقف غير صالحة.' });

  const existingStops = routeRepository.findStopsByRouteId(req.params.id);
  const orderSequence = existingStops.reduce((max, s) => Math.max(max, s.orderSequence), 0) + 1;

  const stop = routeRepository.createStop({ routeId: req.params.id, name: name.trim(), lat, lng, orderSequence });
  res.json({ success: true, stop });
});

fleetRouter.patch('/api/governed/routes/:routeId/stops/:stopId', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const stop = routeRepository.findStopById(req.params.stopId);
  if (!stop || stop.routeId !== req.params.routeId) return res.status(404).json({ error: 'نقطة التوقف غير موجودة.' });

  const { name, lat, lng, orderSequence } = req.body ?? {};
  const changes: Parameters<typeof routeRepository.updateStop>[1] = {};
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) return res.status(422).json({ error: 'اسم نقطة التوقف غير صالح.' });
    changes.name = name.trim();
  }
  if (lat !== undefined || lng !== undefined) {
    const nextLat = lat !== undefined ? lat : stop.lat;
    const nextLng = lng !== undefined ? lng : stop.lng;
    if (!isValidCoordinate(nextLat, nextLng)) return res.status(422).json({ error: 'إحداثيات نقطة التوقف غير صالحة.' });
    changes.lat = nextLat;
    changes.lng = nextLng;
  }
  if (orderSequence !== undefined) {
    if (typeof orderSequence !== 'number' || !Number.isInteger(orderSequence) || orderSequence <= 0) return res.status(422).json({ error: 'ترتيب نقطة التوقف غير صالح.' });
    changes.orderSequence = orderSequence;
  }

  routeRepository.updateStop(req.params.stopId, changes);
  res.json({ success: true, stop: routeRepository.findStopById(req.params.stopId) });
});

fleetRouter.delete('/api/governed/routes/:routeId/stops/:stopId', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const stop = routeRepository.findStopById(req.params.stopId);
  if (!stop || stop.routeId !== req.params.routeId) return res.status(404).json({ error: 'نقطة التوقف غير موجودة.' });

  routeRepository.deleteStop(req.params.stopId);
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------

// The one write in this file with real cross-entity validation (spec §8) —
// see server/services/FleetProvisioningService.ts's createTrip for the
// actual rules (route must have stops, bus not in maintenance, no
// duplicate active trip on the bus/driver). Every rejection is a specific,
// human-readable Arabic message — never a generic 500 or a raw
// constraint-violation leak. Journeys are NOT created here — the existing,
// unchanged ensureJourneysForTrip (called lazily by /api/driver/trips,
// /api/operations/journeys, etc.) picks up this trip automatically the
// first time anyone reads it, exactly as it already does for seeded trips.
fleetRouter.post('/api/governed/trips', (req, res) => {
  const identity = requireVerifiedEmail(req.headers.authorization);
  if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
  const guard = requireOperationalUser(identity.email);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const { routeId, busId, driverId } = req.body ?? {};
  if (typeof routeId !== 'string' || !routeId) return res.status(422).json({ error: 'يجب تحديد المسار.' });
  if (typeof busId !== 'string' || !busId) return res.status(422).json({ error: 'يجب تحديد الحافلة.' });
  if (driverId !== undefined && driverId !== null && (typeof driverId !== 'string' || !driverId)) {
    return res.status(422).json({ error: 'معرّف السائق غير صالح.' });
  }

  try {
    const trip = createTrip({ routeId, busId, driverId });
    res.json({ success: true, trip });
  } catch (err) {
    if (err instanceof TripValidationError) return res.status(422).json({ error: err.message });
    console.error('Trip creation error:', err);
    res.status(500).json({ error: 'حدث خطأ غير متوقع أثناء إنشاء الرحلة.' });
  }
});
