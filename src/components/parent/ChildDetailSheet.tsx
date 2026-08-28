import React, { useEffect, useState } from 'react';
import { Student, Bus, JourneyState, GovernedRouteStop } from '../../types';
import { AuthUser } from '../AuthModal';
import { getParentJourneys } from '../../services/parentApi';
import { getRouteStops } from '../../services/journeysApi';
import { ParentJourneyView } from '../../types';
import { Sheet, Badge, Button, ConfirmDialog, Select, Field } from '../ui';
import type { Tone } from '../ui';
import { LiveRadar } from '../live/LiveRadar';
import { Phone, MessageCircle, MapPin, Clock, ShieldCheck, UserX, Check, Circle } from 'lucide-react';

interface ChildDetailSheetProps {
  student: Student | null;
  bus: Bus | undefined;
  currentUser: AuthUser | null;
  onClose: () => void;
  onUpdateStatus: (studentId: string, status: 'boarded' | 'absent') => void;
}

const STATUS_META: Record<Student['status'], { label: string; tone: Tone }> = {
  boarded: { label: 'صعد الحافلة', tone: 'success' },
  at_school: { label: 'وصل إلى المدرسة', tone: 'success' },
  waiting: { label: 'ينتظر الحافلة', tone: 'warning' },
  at_home: { label: 'في المنزل', tone: 'neutral' },
  absent: { label: 'غائب اليوم', tone: 'danger' }
};

const TRIP_HEADLINE: Record<JourneyState, { label: string; tone: Tone }> = {
  scheduled: { label: 'لم تبدأ الرحلة بعد', tone: 'neutral' },
  waiting: { label: 'الرحلة بدأت — بانتظار الصعود', tone: 'info' },
  boarding: { label: 'جارٍ صعود الطالب', tone: 'info' },
  on_bus: { label: 'الرحلة جارية الآن', tone: 'success' },
  in_transit: { label: 'الرحلة جارية الآن', tone: 'success' },
  approaching_stop: { label: 'تقترب الحافلة من الوجهة', tone: 'success' },
  dropped_off: { label: 'وصل الطالب', tone: 'success' },
  completed: { label: 'اكتملت الرحلة', tone: 'success' },
  missed: { label: 'فاتت الرحلة', tone: 'danger' },
  cancelled: { label: 'أُلغيت الرحلة', tone: 'neutral' },
  incident: { label: 'حادثة مُبلّغ عنها', tone: 'danger' }
};

/** Journey Progress checklist — mapped 1:1 onto the real JourneyState machine, never an invented state (see docs/LIVE_TRACKING_ARCHITECTURE_AUDIT.md §2a). */
function journeySteps(state: JourneyState | undefined) {
  const order: JourneyState[] = ['scheduled', 'waiting', 'on_bus', 'in_transit', 'approaching_stop', 'dropped_off'];
  const idx = state ? order.indexOf(state === 'boarding' ? 'waiting' : state) : -1;
  const effectiveIdx = state === 'completed' ? order.length : idx;

  const steps = [
    { key: 'started', label: 'بدأت الرحلة', atIndex: 1 },
    { key: 'left', label: 'غادرت الحافلة نقطة الانطلاق', atIndex: 2 },
    { key: 'travelling', label: 'الرحلة جارية الآن', atIndex: 3 },
    { key: 'approaching', label: 'تقترب من المدرسة', atIndex: 4 },
    { key: 'arrived', label: 'وصلت إلى المدرسة', atIndex: 5 }
  ];

  return steps.map((step) => ({
    ...step,
    done: effectiveIdx >= step.atIndex,
    current: effectiveIdx === step.atIndex - 1 && effectiveIdx >= 0
  }));
}

function minutesUntil(iso: string | null): number | null {
  if (!iso) return null;
  const diffMs = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.round(diffMs / 60000));
}

/**
 * Phase 13 — re-enabled using a real, stable ID, replacing the Phase 11
 * name-matching disable. `legacyStudentId` is this sheet's own legacy
 * `Student.id` (`student.id` below) — never a display name. The backend
 * (ParentJourneyService.buildView, server/domain/parentAccessContract.ts)
 * now returns that same legacy ID on every view's `child.legacyStudentId`,
 * a real foreign key (database/schema.ts's `students.legacyStudentId`),
 * so matching here is an exact ID comparison, not a guess that could
 * mismatch two same-named children.
 */
function useGovernedRecord(sessionToken: string | undefined, legacyStudentId: string | undefined) {
  const [view, setView] = useState<ParentJourneyView | null | undefined>(undefined);
  useEffect(() => {
    if (!sessionToken || !legacyStudentId) return;
    let cancelled = false;
    const load = () =>
      getParentJourneys(sessionToken)
        .then((views) => {
          if (cancelled) return;
          setView(views.find((v) => v.child.legacyStudentId === legacyStudentId) ?? null);
        })
        .catch(() => !cancelled && setView(null));
    load();
    const interval = setInterval(load, 6000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionToken, legacyStudentId]);
  return view;
}

export const ChildDetailSheet: React.FC<ChildDetailSheetProps> = ({ student, bus, currentUser, onClose, onUpdateStatus }) => {
  const [showAbsenceConfirm, setShowAbsenceConfirm] = useState(false);
  const [absenceReason, setAbsenceReason] = useState('عذر مرضي');
  const [stops, setStops] = useState<GovernedRouteStop[]>([]);

  const governedView = useGovernedRecord(currentUser?.sessionToken, student?.id);

  useEffect(() => {
    const routeId = governedView?.route?.id;
    if (!routeId || !currentUser?.sessionToken) {
      setStops([]);
      return;
    }
    getRouteStops(routeId, currentUser.sessionToken).then(setStops).catch(() => setStops([]));
  }, [governedView?.route?.id, currentUser?.sessionToken]);

  if (!student) return null;
  const status = STATUS_META[student.status];
  const hasLiveJourney = governedView && governedView.journey;
  const headline = hasLiveJourney ? TRIP_HEADLINE[governedView!.journey!.state] : null;
  const etaMinutes = governedView?.eta ? minutesUntil(governedView.eta.estimatedArrivalAt) : null;

  const handleReportAbsence = () => {
    onUpdateStatus(student.id, 'absent');
    setShowAbsenceConfirm(false);
  };

  return (
    <>
      <Sheet isOpen={!!student} onClose={onClose} title={student.name} subtitle={student.schoolName}>
        <div className="space-y-5">
          {/* Live Journey — governed data only, the one honest "live" source */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <Badge tone={hasLiveJourney ? headline!.tone : status.tone}>{hasLiveJourney ? headline!.label : status.label}</Badge>
              {etaMinutes !== null ? (
                <span className="text-sm font-bold text-primary bg-primary-soft px-2.5 py-1 rounded-lg">الوصول خلال {etaMinutes} دقيقة</span>
              ) : bus ? (
                <span className="text-sm font-bold text-text-secondary bg-surface-sunken px-2.5 py-1 rounded-lg">{bus.busNumber}</span>
              ) : null}
            </div>
            {governedView?.driver && <p className="text-xs text-text-secondary">السائق: {governedView.driver.displayName}</p>}

            {!hasLiveJourney && (
              <p className="text-xs text-text-tertiary mt-2 bg-surface-sunken border border-border-default rounded-xl p-3">
                لا توجد رحلة مباشرة نشطة لهذا الطالب حالياً. سيظهر التتبع المباشر هنا فور بدء السائق للرحلة.
              </p>
            )}
          </div>

          {hasLiveJourney && (
            <>
              <LiveRadar
                mode="single"
                title="تتبع الحافلة المباشر"
                busLabel={governedView!.bus?.label ?? student.busNumber}
                position={
                  governedView!.location
                    ? {
                        lat: governedView!.location.latitude,
                        lng: governedView!.location.longitude,
                        speedKmh: governedView!.location.speedKmh,
                        heading: governedView!.location.heading,
                        freshness: governedView!.location.freshness,
                        receivedAt: governedView!.location.receivedAt
                      }
                    : null
                }
                stops={stops.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, name: s.name }))}
              />

              {/* Journey Progress checklist */}
              <div className="bg-surface-sunken border border-border-default rounded-xl p-4 space-y-2.5">
                <h4 className="text-xs font-bold text-text-secondary mb-1">تقدّم الرحلة</h4>
                {journeySteps(governedView!.journey!.state).map((step) => (
                  <div key={step.key} className="flex items-center gap-2.5">
                    {step.done ? (
                      <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : step.current ? (
                      <span className="w-4 h-4 rounded-full bg-primary shrink-0 flex items-center justify-center">
                        <span className="w-1.5 h-1.5 rounded-full bg-white" />
                      </span>
                    ) : (
                      <Circle className="w-4 h-4 text-slate-300 shrink-0" />
                    )}
                    <span className={`text-sm ${step.done || step.current ? 'text-text-primary font-bold' : 'text-text-tertiary'}`}>{step.label}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Static profile info (legacy — the record every other role also sees) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-surface-sunken border border-border-default rounded-xl p-3.5 flex items-start gap-3">
              <MapPin className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-xs text-text-secondary">نقطة التوقف</div>
                <div className="font-bold text-sm text-text-primary">{student.pickupPoint.nameAr}</div>
              </div>
            </div>
            <div className="bg-surface-sunken border border-border-default rounded-xl p-3.5 flex items-start gap-3">
              <Clock className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-xs text-text-secondary">وقت الصعود المخطط</div>
                <div className="font-bold text-sm text-text-primary">{student.pickupTimePlanned}</div>
                {student.pickupTimeActual && <div className="text-xs text-emerald-700 font-bold">تم فعلياً: {student.pickupTimeActual}</div>}
              </div>
            </div>
          </div>

          {bus && (
            <div className="border-t border-border-default pt-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-bold text-sm text-text-primary">سائق الحافلة</h4>
                <Badge tone="success" icon={<ShieldCheck className="w-3.5 h-3.5" />}>مرخّص</Badge>
              </div>
              <div className="flex items-center gap-3 mb-3">
                <img src={bus.driverAvatar} alt={bus.driverName} className="w-12 h-12 rounded-xl object-cover border border-border-default" />
                <div className="min-w-0">
                  <div className="font-bold text-sm text-text-primary truncate">{bus.driverName}</div>
                  <div className="text-xs text-text-secondary">{bus.busNumber} · لوحة {bus.plateNumber}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <a href={`tel:${bus.driverPhone}`}>
                  <Button variant="primary" size="md" fullWidth icon={<Phone className="w-4 h-4" />}>اتصال</Button>
                </a>
                <a href={`https://wa.me/${bus.driverPhone.replace(/\s+/g, '')}`} target="_blank" rel="noreferrer">
                  <Button variant="secondary" size="md" fullWidth icon={<MessageCircle className="w-4 h-4 text-emerald-600" />}>واتساب</Button>
                </a>
              </div>
            </div>
          )}

          <div className="border-t border-border-default pt-4">
            <Button variant="secondary" fullWidth icon={<UserX className="w-4 h-4 text-danger" />} onClick={() => setShowAbsenceConfirm(true)}>
              الإبلاغ عن غياب اليوم
            </Button>
          </div>
        </div>
      </Sheet>

      <ConfirmDialog
        isOpen={showAbsenceConfirm}
        tone="warning"
        title={`تسجيل غياب ${student.name}`}
        description="سيتم تعديل مسار الحافلة وتوفير وقت الانتظار لبقية الطلاب. يمكنك التراجع عن هذا لاحقاً بالتواصل مع المدرسة."
        confirmLabel="تأكيد الغياب"
        onConfirm={handleReportAbsence}
        onCancel={() => setShowAbsenceConfirm(false)}
      >
        <Field label="سبب الغياب (اختياري)">
          <Select value={absenceReason} onChange={(e) => setAbsenceReason(e.target.value)}>
            <option value="عذر مرضي">عذر مرضي</option>
            <option value="سفر أو ظرف عائلي">سفر أو ظرف عائلي</option>
            <option value="توصيل خاص بواسطة ولي الأمر">توصيل خاص بواسطة ولي الأمر</option>
          </Select>
        </Field>
      </ConfirmDialog>
    </>
  );
};
