import React, { useState, useEffect } from 'react';
import { AuthUser } from './AuthModal';
import { legacyAuthHeaders } from '../services/legacyAuthHeaders';
import { Sheet, Tabs, Card, Field, Input, Select, FormSection, Button, EmptyState, Alert, Badge } from './ui';
import type { TabItem, Tone } from './ui';
import { Bus as BusIcon, Navigation, MapPin, Plus, Trash2 } from 'lucide-react';

// Phase 15 — Pilot Hardening: the minimum live operational-setup UI a real
// school/admin needs to establish School -> Route -> Stops -> Bus -> Driver
// -> Trip without any database intervention (see docs/PHASE_14... report
// §31, which explicitly flagged this as the remaining scope boundary).
// Deliberately minimal — create + the one edit each entity actually needs
// for a controlled pilot, not a full fleet-management product. Once a trip
// exists here, journeys for it appear automatically the moment any student
// already carries that trip's busId (the existing, unchanged
// ensureJourneysForTrip) — this modal never creates journeys directly.

interface GovernedBus {
  id: string;
  busNumber: string;
  plateNumber: string;
  driverId: string | null;
  capacity: number;
  status: string;
}
interface GovernedDriver {
  id: string;
  name: string;
  phone: string;
}
interface GovernedRoute {
  id: string;
  name: string;
  status: string;
}
interface GovernedStop {
  id: string;
  routeId: string;
  name: string;
  lat: number;
  lng: number;
  orderSequence: number;
}
interface GovernedTrip {
  id: string;
  routeId: string;
  busId: string;
  driverId: string | null;
  status: string;
}

const BUS_STATUS_LABELS: Record<string, { label: string; tone: Tone }> = {
  idle: { label: 'نشطة', tone: 'success' },
  en_route_pickup: { label: 'في طريق الاصطحاب', tone: 'info' },
  en_route_school: { label: 'في طريقها للمدرسة', tone: 'info' },
  returning: { label: 'في طريق العودة', tone: 'info' },
  maintenance: { label: 'تحت الصيانة', tone: 'danger' },
};
const TRIP_STATUS_LABELS: Record<string, { label: string; tone: Tone }> = {
  scheduled: { label: 'مجدولة', tone: 'neutral' },
  active: { label: 'جارية', tone: 'success' },
  completed: { label: 'مكتملة', tone: 'neutral' },
  cancelled: { label: 'ملغاة', tone: 'danger' },
};

const TABS: TabItem[] = [
  { id: 'buses', label: 'الحافلات', icon: <BusIcon className="w-4 h-4" /> },
  { id: 'routes', label: 'المسارات ونقاط التوقف', icon: <Navigation className="w-4 h-4" /> },
  { id: 'trips', label: 'الرحلات', icon: <MapPin className="w-4 h-4" /> },
];

interface GovernedFleetSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AuthUser | null;
}

export const GovernedFleetSetupModal: React.FC<GovernedFleetSetupModalProps> = ({ isOpen, onClose, currentUser }) => {
  const [activeTab, setActiveTab] = useState<'buses' | 'routes' | 'trips'>('buses');
  const [buses, setBuses] = useState<GovernedBus[]>([]);
  const [drivers, setDrivers] = useState<GovernedDriver[]>([]);
  const [routes, setRoutes] = useState<GovernedRoute[]>([]);
  const [stopsByRoute, setStopsByRoute] = useState<Record<string, GovernedStop[]>>({});
  const [trips, setTrips] = useState<GovernedTrip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const headers = { 'Content-Type': 'application/json', ...legacyAuthHeaders(currentUser?.sessionToken) };
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadAll = () => {
    if (!currentUser?.sessionToken) return;
    const h = legacyAuthHeaders(currentUser.sessionToken);
    fetch('/api/governed/buses', { headers: h }).then((r) => r.json()).then((d) => Array.isArray(d) && setBuses(d)).catch(() => {});
    fetch('/api/governed/drivers', { headers: h }).then((r) => r.json()).then((d) => Array.isArray(d) && setDrivers(d)).catch(() => {});
    fetch('/api/trips', { headers: h }).then((r) => r.json()).then((d) => Array.isArray(d) && setTrips(d)).catch(() => {});
  };

  useEffect(() => {
    if (isOpen) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentUser?.sessionToken]);

  // Routes are read via each governed route's own GET /api/routes/:id — no
  // list endpoint exists for governed routes today (only /api/governed/buses
  // was built in Phase 14), so this reconstructs the route list from every
  // route referenced by a real trip PLUS newly-created ones tracked locally.
  const [knownRouteIds, setKnownRouteIds] = useState<string[]>([]);
  useEffect(() => {
    if (!isOpen || !currentUser?.sessionToken) return;
    const h = legacyAuthHeaders(currentUser.sessionToken);
    const ids = Array.from(new Set([...trips.map((t) => t.routeId), ...knownRouteIds]));
    Promise.all(
      ids.map((id) =>
        fetch(`/api/routes/${id}`, { headers: h })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      )
    ).then((results) => setRoutes(results.filter(Boolean) as GovernedRoute[]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentUser?.sessionToken, trips.length, knownRouteIds.join(',')]);

  useEffect(() => {
    if (!isOpen || !currentUser?.sessionToken) return;
    const h = legacyAuthHeaders(currentUser.sessionToken);
    routes.forEach((route) => {
      fetch(`/api/routes/${route.id}/stops`, { headers: h })
        .then((r) => r.json())
        .then((d) => Array.isArray(d) && setStopsByRoute((prev) => ({ ...prev, [route.id]: d })))
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentUser?.sessionToken, routes.map((r) => r.id).join(',')]);

  // --- Bus form ---
  const [busNumber, setBusNumber] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [capacity, setCapacity] = useState('24');
  const [showBusForm, setShowBusForm] = useState(false);

  const handleCreateBus = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch('/api/governed/buses', { method: 'POST', headers, body: JSON.stringify({ busNumber: busNumber.trim(), plateNumber: plateNumber.trim(), capacity: parseInt(capacity, 10) }) });
      const data = await res.json();
      if (data.success) {
        setBusNumber('');
        setPlateNumber('');
        setShowBusForm(false);
        showToast(`تمت إضافة الحافلة ${data.bus.busNumber}`);
        loadAll();
      } else {
        setError(data.error || 'تعذّر إنشاء الحافلة.');
      }
    } catch {
      setError('حدث خطأ في الاتصال بالخادم.');
    }
  };

  const handleAssignDriver = async (busId: string, driverId: string | null) => {
    setError(null);
    try {
      const res = await fetch(`/api/governed/buses/${busId}/assign-driver`, { method: 'PATCH', headers, body: JSON.stringify({ driverId }) });
      const data = await res.json();
      if (data.success) loadAll();
      else setError(data.error || 'تعذّر تحديث إسناد السائق.');
    } catch {
      setError('حدث خطأ في الاتصال بالخادم.');
    }
  };

  const handleToggleBusStatus = async (bus: GovernedBus) => {
    setError(null);
    const nextStatus = bus.status === 'maintenance' ? 'idle' : 'maintenance';
    try {
      const res = await fetch(`/api/governed/buses/${bus.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: nextStatus }) });
      const data = await res.json();
      if (data.success) loadAll();
      else setError(data.error || 'تعذّر تحديث حالة الحافلة.');
    } catch {
      setError('حدث خطأ في الاتصال بالخادم.');
    }
  };

  // --- Route form ---
  const [routeName, setRouteName] = useState('');
  const [showRouteForm, setShowRouteForm] = useState(false);
  const [stopDrafts, setStopDrafts] = useState<Record<string, { name: string; lat: string; lng: string }>>({});

  const handleCreateRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch('/api/governed/routes', { method: 'POST', headers, body: JSON.stringify({ name: routeName.trim() }) });
      const data = await res.json();
      if (data.success) {
        setRouteName('');
        setShowRouteForm(false);
        setKnownRouteIds((prev) => [...prev, data.route.id]);
        showToast(`تمت إضافة المسار ${data.route.name}`);
      } else {
        setError(data.error || 'تعذّر إنشاء المسار.');
      }
    } catch {
      setError('حدث خطأ في الاتصال بالخادم.');
    }
  };

  const handleAddStop = async (routeId: string) => {
    const draft = stopDrafts[routeId];
    if (!draft?.name?.trim()) {
      setError('يرجى إدخال اسم نقطة التوقف.');
      return;
    }
    const lat = parseFloat(draft.lat);
    const lng = parseFloat(draft.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setError('يرجى إدخال إحداثيات صحيحة (خط العرض وخط الطول).');
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/governed/routes/${routeId}/stops`, { method: 'POST', headers, body: JSON.stringify({ name: draft.name.trim(), lat, lng }) });
      const data = await res.json();
      if (data.success) {
        setStopDrafts((prev) => ({ ...prev, [routeId]: { name: '', lat: '', lng: '' } }));
        showToast('تمت إضافة نقطة التوقف');
        fetch(`/api/routes/${routeId}/stops`, { headers: legacyAuthHeaders(currentUser?.sessionToken) })
          .then((r) => r.json())
          .then((d) => Array.isArray(d) && setStopsByRoute((prev) => ({ ...prev, [routeId]: d })));
      } else {
        setError(data.error || 'تعذّر إضافة نقطة التوقف.');
      }
    } catch {
      setError('حدث خطأ في الاتصال بالخادم.');
    }
  };

  // --- Trip form ---
  const [tripRouteId, setTripRouteId] = useState('');
  const [tripBusId, setTripBusId] = useState('');
  const [tripDriverId, setTripDriverId] = useState('');
  const [showTripForm, setShowTripForm] = useState(false);

  const handleCreateTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch('/api/governed/trips', {
        method: 'POST',
        headers,
        body: JSON.stringify({ routeId: tripRouteId, busId: tripBusId, driverId: tripDriverId || null }),
      });
      const data = await res.json();
      if (data.success) {
        setShowTripForm(false);
        showToast('تم إنشاء الرحلة');
        loadAll();
      } else {
        setError(data.error || 'تعذّر إنشاء الرحلة.');
      }
    } catch {
      setError('حدث خطأ في الاتصال بالخادم.');
    }
  };

  if (!isOpen) return null;

  const busNumberById = (id: string) => buses.find((b) => b.id === id)?.busNumber ?? '—';
  const driverNameById = (id: string | null) => (id ? drivers.find((d) => d.id === id)?.name ?? '—' : 'غير مُسند');
  const routeNameById = (id: string) => routes.find((r) => r.id === id)?.name ?? '—';

  return (
    <Sheet isOpen={isOpen} onClose={onClose} title="إعداد التشغيل" subtitle="الحافلات، المسارات، ونقاط التوقف والرحلات">
      <div className="space-y-4">
        {error && <Alert tone="danger" title={error} onDismiss={() => setError(null)} />}
        {toast && <Alert tone="success" title={toast} />}

        <Tabs items={TABS} activeId={activeTab} onChange={(id) => setActiveTab(id as typeof activeTab)} />

        {activeTab === 'buses' && (
          <div className="space-y-3">
            {!showBusForm ? (
              <Button variant="secondary" fullWidth icon={<Plus className="w-4 h-4" />} onClick={() => setShowBusForm(true)}>
                إضافة حافلة
              </Button>
            ) : (
              <Card as="form" onSubmit={handleCreateBus} className="space-y-3">
                <FormSection title="حافلة جديدة">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Field label="رقم الحافلة" required>
                      <Input required value={busNumber} onChange={(e) => setBusNumber(e.target.value)} />
                    </Field>
                    <Field label="رقم اللوحة" required>
                      <Input required dir="ltr" value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} className="text-right" />
                    </Field>
                    <Field label="السعة" required>
                      <Input type="number" min={1} required value={capacity} onChange={(e) => setCapacity(e.target.value)} />
                    </Field>
                  </div>
                </FormSection>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setShowBusForm(false)}>إلغاء</Button>
                  <Button type="submit" fullWidth>حفظ الحافلة</Button>
                </div>
              </Card>
            )}

            {buses.length === 0 ? (
              <EmptyState icon={<BusIcon />} title="لا توجد حافلات بعد" />
            ) : (
              <div className="space-y-2">
                {buses.map((bus) => {
                  const statusMeta = BUS_STATUS_LABELS[bus.status] ?? { label: bus.status, tone: 'neutral' as Tone };
                  return (
                    <Card key={bus.id} padding="sm" className="space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-1.5">
                        <div>
                          <span className="font-bold text-sm text-text-primary">{bus.busNumber}</span>
                          <div className="text-xs text-text-secondary" dir="ltr">{bus.plateNumber} · السعة {bus.capacity}</div>
                        </div>
                        <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-text-secondary font-bold shrink-0">السائق:</label>
                        <select
                          value={bus.driverId || ''}
                          onChange={(e) => handleAssignDriver(bus.id, e.target.value || null)}
                          className="flex-1 bg-surface-sunken border border-border-default rounded-lg px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-primary"
                        >
                          <option value="">— غير مُسند —</option>
                          {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </div>
                      <Button size="sm" variant={bus.status === 'maintenance' ? 'secondary' : 'danger'} onClick={() => handleToggleBusStatus(bus)}>
                        {bus.status === 'maintenance' ? 'تفعيل الحافلة' : 'تعطيل الحافلة (صيانة)'}
                      </Button>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'routes' && (
          <div className="space-y-3">
            {!showRouteForm ? (
              <Button variant="secondary" fullWidth icon={<Plus className="w-4 h-4" />} onClick={() => setShowRouteForm(true)}>
                إضافة مسار
              </Button>
            ) : (
              <Card as="form" onSubmit={handleCreateRoute} className="space-y-3">
                <FormSection title="مسار جديد">
                  <Field label="اسم المسار" required>
                    <Input required value={routeName} onChange={(e) => setRouteName(e.target.value)} />
                  </Field>
                </FormSection>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setShowRouteForm(false)}>إلغاء</Button>
                  <Button type="submit" fullWidth>حفظ المسار</Button>
                </div>
              </Card>
            )}

            {routes.length === 0 ? (
              <EmptyState icon={<Navigation />} title="لا توجد مسارات بعد" />
            ) : (
              <div className="space-y-3">
                {routes.map((route) => {
                  const stops = (stopsByRoute[route.id] ?? []).slice().sort((a, b) => a.orderSequence - b.orderSequence);
                  const draft = stopDrafts[route.id] ?? { name: '', lat: '', lng: '' };
                  return (
                    <Card key={route.id} padding="sm" className="space-y-2">
                      <div className="font-bold text-sm text-text-primary">{route.name}</div>
                      {stops.length === 0 ? (
                        <p className="text-xs text-text-tertiary">لا توجد نقاط توقف بعد — يجب إضافة نقطة توقف واحدة على الأقل قبل إنشاء رحلة على هذا المسار.</p>
                      ) : (
                        <ol className="text-xs text-text-secondary space-y-1 list-decimal pr-4">
                          {stops.map((s) => <li key={s.id}>{s.name} ({s.lat.toFixed(4)}, {s.lng.toFixed(4)})</li>)}
                        </ol>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 border-t border-border-default pt-2">
                        <Input placeholder="اسم نقطة التوقف" value={draft.name} onChange={(e) => setStopDrafts((prev) => ({ ...prev, [route.id]: { ...draft, name: e.target.value } }))} />
                        <Input placeholder="خط العرض" dir="ltr" value={draft.lat} onChange={(e) => setStopDrafts((prev) => ({ ...prev, [route.id]: { ...draft, lat: e.target.value } }))} />
                        <Input placeholder="خط الطول" dir="ltr" value={draft.lng} onChange={(e) => setStopDrafts((prev) => ({ ...prev, [route.id]: { ...draft, lng: e.target.value } }))} />
                        <Button size="sm" variant="secondary" onClick={() => handleAddStop(route.id)}>إضافة نقطة توقف</Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'trips' && (
          <div className="space-y-3">
            {!showTripForm ? (
              <Button variant="secondary" fullWidth icon={<Plus className="w-4 h-4" />} onClick={() => setShowTripForm(true)}>
                إنشاء رحلة
              </Button>
            ) : (
              <Card as="form" onSubmit={handleCreateTrip} className="space-y-3">
                <FormSection title="رحلة جديدة" description="يجب أن يحتوي المسار على نقطة توقف واحدة على الأقل، وألا تكون الحافلة تحت الصيانة أو مرتبطة برحلة أخرى نشطة.">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Field label="المسار" required>
                      <Select required value={tripRouteId} onChange={(e) => setTripRouteId(e.target.value)}>
                        <option value="">اختر مساراً</option>
                        {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </Select>
                    </Field>
                    <Field label="الحافلة" required>
                      <Select required value={tripBusId} onChange={(e) => setTripBusId(e.target.value)}>
                        <option value="">اختر حافلة</option>
                        {buses.map((b) => <option key={b.id} value={b.id}>{b.busNumber}</option>)}
                      </Select>
                    </Field>
                    <Field label="السائق (اختياري)">
                      <Select value={tripDriverId} onChange={(e) => setTripDriverId(e.target.value)}>
                        <option value="">— يُستخدم سائق الحافلة الحالي —</option>
                        {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </Select>
                    </Field>
                  </div>
                </FormSection>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setShowTripForm(false)}>إلغاء</Button>
                  <Button type="submit" fullWidth>إنشاء الرحلة</Button>
                </div>
              </Card>
            )}

            {trips.length === 0 ? (
              <EmptyState icon={<MapPin />} title="لا توجد رحلات بعد" />
            ) : (
              <div className="space-y-2">
                {trips.map((trip) => {
                  const statusMeta = TRIP_STATUS_LABELS[trip.status] ?? { label: trip.status, tone: 'neutral' as Tone };
                  return (
                    <Card key={trip.id} padding="sm">
                      <div className="flex items-center justify-between flex-wrap gap-1.5">
                        <div>
                          <span className="font-bold text-sm text-text-primary">{routeNameById(trip.routeId)}</span>
                          <div className="text-xs text-text-secondary">{busNumberById(trip.busId)} · {driverNameById(trip.driverId)}</div>
                        </div>
                        <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
};
