import React, { useEffect, useState } from 'react';
import { Bus, Student, Route } from '../types';
import { SwipeableCard } from './SwipeableCard';
import { AuthUser } from './AuthModal';
import { DriverJourneyConsole } from './DriverJourneyConsole';
import { Button, Card, Badge, ConfirmDialog, Sheet, EmptyState, Metric, StatusDot } from './ui';
import { LiveRadar, RadarPosition } from './live/LiveRadar';
import { getBusCurrentLocation } from '../services/currentLocationApi';
import {
  Navigation,
  CheckCircle2,
  XCircle,
  AlertOctagon,
  Clock,
  Users,
  Play,
  ChevronDown,
  ChevronUp,
  MapPin,
  Wrench
} from 'lucide-react';

/** Polls the driver's OWN bus current-location projection (server-scoped, real telemetry — see docs/LIVE_TRACKING_ARCHITECTURE_AUDIT.md). Never fabricated: null means honestly no data yet. */
function useOwnBusLocation(busId: string | undefined, userEmail: string | undefined) {
  const [position, setPosition] = useState<RadarPosition | null>(null);
  useEffect(() => {
    if (!busId || !userEmail) return;
    let cancelled = false;
    const load = () =>
      getBusCurrentLocation(busId, userEmail)
        .then((loc) => {
          if (cancelled) return;
          setPosition(loc ? { lat: loc.latitude, lng: loc.longitude, speedKmh: loc.speed, heading: loc.heading, freshness: loc.freshness, receivedAt: loc.receivedAt } : null);
        })
        .catch(() => !cancelled && setPosition(null));
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [busId, userEmail]);
  return position;
}

interface DriverPortalProps {
  buses: Bus[];
  students: Student[];
  routes: Route[];
  onUpdateStatus: (studentId: string, status: 'boarded' | 'absent') => void;
  onTriggerReroute: (busId: string, incident: string) => void;
  onStartRoute?: (busId: string) => void;
  currentUser: AuthUser | null;
}

const INCIDENT_OPTIONS = [
  'حوادث أو أعمال صيانة على طريق الملك فهد',
  'ازدحام مروري خانق عند دوار حي الياسمين',
  'إغلاق مؤقت لشارع الإمام سعود',
  'عطل ميكانيكي بسيط بالحافلة'
];

/**
 * Phase 9B — the driver's whole workday is one evolving screen, not a
 * dashboard: a pre-trip summary that becomes an in-progress operational
 * view once started. The legacy per-student boarding list is what parents
 * and the school actually see (it writes to Student.status), so it stays
 * the PRIMARY action surface; the governed DriverJourneyConsole is a
 * separate, more detailed system (Journey Core) that does not write to the
 * same record — see the transformation report's P0-2 section — so it is
 * folded in as a secondary "official trip log", never presented as a
 * second competing student list.
 */
export const DriverPortal: React.FC<DriverPortalProps> = ({ buses, students, routes, onUpdateStatus, onTriggerReroute, onStartRoute, currentUser }) => {
  const ownedBus = buses.find((b) => b.driverId === currentUser?.id);
  const activeBus = buses.length === 0 ? buses[0] : ownedBus;
  const activeRoute = activeBus ? routes.find((r) => r.busId === activeBus.id) || routes[0] : routes[0];
  const busStudents = activeBus ? students.filter((s) => s.busId === activeBus.id) : [];

  const [showStartConfirm, setShowStartConfirm] = useState(false);
  const [safetyChecks, setSafetyChecks] = useState({ busInspection: true, seatbelts: true, studentsList: true });
  const [routeStartedToast, setRouteStartedToast] = useState(false);
  const [showIncidentSheet, setShowIncidentSheet] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState(INCIDENT_OPTIONS[0]);
  const [showOfficialLog, setShowOfficialLog] = useState(false);
  const ownBusPosition = useOwnBusLocation(activeBus?.id, currentUser?.email);

  if (buses.length > 0 && !ownedBus) {
    return <EmptyState icon={<Navigation />} title="لا توجد حافلة مسندة لحسابك" description="تواصل مع إدارة المدرسة لإتمام إسناد حافلة ومسار لك." />;
  }

  if (!activeBus || !activeRoute) {
    return (
      <div className="space-y-3">
        <Card><div className="h-24 animate-skeleton bg-slate-100 rounded-xl" /></Card>
      </div>
    );
  }

  if (activeBus.status === 'maintenance') {
    return <EmptyState icon={<Wrench />} title="الحافلة تحت الصيانة حالياً" description="سيتم إشعارك فور جاهزية الحافلة للانطلاق." />;
  }

  const tripInProgress = activeBus.status !== 'idle';
  const boardedCount = busStudents.filter((s) => s.status === 'boarded').length;
  const waitingCount = busStudents.filter((s) => s.status === 'waiting' || s.status === 'at_home').length;
  const absentCount = busStudents.filter((s) => s.status === 'absent').length;

  const handleConfirmStart = () => {
    if (onStartRoute && activeBus) onStartRoute(activeBus.id);
    setShowStartConfirm(false);
    setRouteStartedToast(true);
    setTimeout(() => setRouteStartedToast(false), 5000);
  };

  const handleSubmitIncident = () => {
    if (activeBus) onTriggerReroute(activeBus.id, selectedIncident);
    setShowIncidentSheet(false);
  };

  return (
    <div className="space-y-5">
      {routeStartedToast && (
        <div className="bg-success-soft border border-success-border rounded-2xl p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <p className="text-sm text-emerald-800 font-bold">تم إعلام إدارة المدرسة وأولياء الأمور بانطلاق الرحلة.</p>
        </div>
      )}

      {/* Trip header */}
      <div>
        <p className="text-sm text-text-secondary">{tripInProgress ? 'الرحلة جارية الآن' : 'رحلة اليوم'}</p>
        <h1 className="text-xl font-bold text-text-primary">{activeRoute.routeNameAr}</h1>
        <p className="text-sm text-text-secondary mt-0.5">{activeBus.busNumber} · لوحة {activeBus.plateNumber}</p>
      </div>

      {!tripInProgress ? (
        <>
          <Card padding="lg" className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-text-secondary">عدد الطلاب</div>
                <div className="text-2xl font-black text-text-primary">{busStudents.length}</div>
              </div>
              <div>
                <div className="text-xs text-text-secondary">المحطة الأولى</div>
                <div className="text-base font-bold text-text-primary">{activeRoute.stops[0]?.nameAr ?? '—'}</div>
              </div>
            </div>
          </Card>
          <Button variant="primary" size="lg" fullWidth icon={<Play className="w-5 h-5 fill-white" />} onClick={() => setShowStartConfirm(true)}>
            بدء الرحلة
          </Button>
        </>
      ) : (
        <>
          {/* Operational KPIs */}
          <div className="grid grid-cols-3 gap-2.5">
            <Metric icon={<CheckCircle2 />} tone="success" value={boardedCount} label="صعدوا" />
            <Metric icon={<Clock />} tone="warning" value={waitingCount} label="ينتظرون" />
            <Metric icon={<XCircle />} tone="danger" value={absentCount} label="غائبون" />
          </div>

          {/* Next stop */}
          <Card className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                <MapPin className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs text-text-secondary">المحطة القادمة</div>
                <div className="font-bold text-text-primary">{activeBus.nextStopName}</div>
              </div>
            </div>
            <Badge tone="info">{activeBus.nextStopEtaMins} د</Badge>
          </Card>

          <LiveRadar mode="single" title="GPS Live Radar" busLabel={activeBus.busNumber} position={ownBusPosition} />

          {/* Actions */}
          <Button variant="secondary" fullWidth icon={<AlertOctagon className="w-4 h-4 text-danger" />} onClick={() => setShowIncidentSheet(true)}>
            الإبلاغ عن طارئ
          </Button>

          {/* Student list — the primary, cross-role-visible boarding action */}
          <div>
            <h2 className="text-sm font-bold text-text-primary mb-2">الطلاب ({busStudents.length})</h2>
            <div className="space-y-2.5">
              {busStudents.map((std) => (
                <SwipeableCard
                  key={std.id}
                  onSwipeRight={() => onUpdateStatus(std.id, 'boarded')}
                  onSwipeLeft={() => onUpdateStatus(std.id, 'absent')}
                  rightActionLabel="تسجيل صعود الطالب"
                  rightActionColor="emerald"
                  rightActionIcon={<CheckCircle2 className="w-5 h-5 text-white" />}
                  leftActionLabel="تسجيل غياب الطالب"
                  leftActionColor="rose"
                  leftActionIcon={<XCircle className="w-5 h-5 text-white" />}
                >
                  <Card padding="sm" className="flex items-center gap-3">
                    <img src={std.avatar} alt={std.name} className="w-11 h-11 rounded-xl object-cover border border-border-default shrink-0" />
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-sm text-text-primary truncate">{std.name}</h4>
                      <p className="text-xs text-text-secondary truncate">{std.grade} · مقعد {std.seatNumber}</p>
                    </div>
                    <StatusDot tone={std.status === 'boarded' ? 'success' : std.status === 'absent' ? 'danger' : 'warning'} className="shrink-0">
                      {std.status === 'boarded' ? 'صعد' : std.status === 'absent' ? 'غائب' : 'ينتظر'}
                    </StatusDot>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => onUpdateStatus(std.id, 'boarded')}
                        className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${std.status === 'boarded' ? 'bg-success text-white' : 'bg-slate-100 text-text-secondary hover:bg-success-soft'}`}
                        title="تسجيل صعود"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => onUpdateStatus(std.id, 'absent')}
                        className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${std.status === 'absent' ? 'bg-danger text-white' : 'bg-slate-100 text-text-secondary hover:bg-danger-soft'}`}
                        title="تسجيل غياب"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                  </Card>
                </SwipeableCard>
              ))}
            </div>
          </div>

          {/* Official governed trip log — secondary, collapsed by default */}
          {currentUser?.email && (
            <div>
              <button onClick={() => setShowOfficialLog((v) => !v)} className="w-full flex items-center justify-between text-sm font-bold text-text-secondary py-2">
                <span className="flex items-center gap-1.5">
                  <Users className="w-4 h-4" />
                  السجل الرسمي للرحلة (النظام المحوكم)
                </span>
                {showOfficialLog ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showOfficialLog && (
                <div className="animate-fade-in">
                  <DriverJourneyConsole userEmail={currentUser.email} />
                </div>
              )}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        isOpen={showStartConfirm}
        tone="info"
        title="تأكيد انطلاق الرحلة"
        description={`${busStudents.length} طالب مسجّل بهذه الرحلة. تأكد من الآتي قبل الانطلاق:`}
        confirmLabel="تأكيد الانطلاق"
        onConfirm={handleConfirmStart}
        onCancel={() => setShowStartConfirm(false)}
      >
        <div className="space-y-2 text-sm">
          {[
            { key: 'busInspection', label: 'فحص الوقود والإطارات وجاهزية المحرك' },
            { key: 'seatbelts', label: 'أحزمة الأمان ووسائل السلامة جاهزة' },
            { key: 'studentsList', label: 'قائمة الطلاب مطابقة لهذه الرحلة' }
          ].map((item) => (
            <label key={item.key} className="flex items-center gap-2.5 cursor-pointer text-text-secondary">
              <input
                type="checkbox"
                checked={(safetyChecks as any)[item.key]}
                onChange={(e) => setSafetyChecks({ ...safetyChecks, [item.key]: e.target.checked })}
                className="w-4 h-4 accent-emerald-600"
              />
              <span>{item.label}</span>
            </label>
          ))}
        </div>
      </ConfirmDialog>

      <Sheet isOpen={showIncidentSheet} onClose={() => setShowIncidentSheet(false)} title="الإبلاغ عن عائق طارئ" footer={<Button fullWidth onClick={handleSubmitIncident}>إرسال البلاغ</Button>}>
        <div className="space-y-2">
          {INCIDENT_OPTIONS.map((option) => (
            <label
              key={option}
              className={`flex items-center gap-2.5 p-3 rounded-xl border text-sm cursor-pointer ${selectedIncident === option ? 'bg-warning-soft border-warning-border font-bold text-amber-900' : 'bg-surface-sunken border-border-default text-text-secondary'}`}
            >
              <input type="radio" name="incident" checked={selectedIncident === option} onChange={() => setSelectedIncident(option)} className="accent-amber-600 w-4 h-4" />
              <span>{option}</span>
            </label>
          ))}
        </div>
      </Sheet>
    </div>
  );
};
