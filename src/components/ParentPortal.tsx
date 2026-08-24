import React, { useState, useEffect } from 'react';
import { Student, Bus, SystemNotification } from '../types';
import { AuthUser } from './AuthModal';
import { ParentJourneyPanel } from './ParentJourneyPanel';
import { legacyAuthHeaders } from '../services/legacyAuthHeaders';
import {
  Phone,
  MessageCircle,
  Clock,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  UserX,
  BellRing,
  Bus as BusIcon,
  ShieldCheck,
  Send,
  Timer,
  Bell,
  Sparkles,
  Check,
  Volume2,
  Smartphone,
  Zap,
  X,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

interface ParentPortalProps {
  students: Student[];
  buses: Bus[];
  notifications: SystemNotification[];
  onUpdateStatus: (studentId: string, status: 'boarded' | 'absent') => void;
  currentUser?: AuthUser | null;
}

const playChimeSound = () => {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch (e) {
    // Graceful fallback for audio policy restrictions
  }
};

export const ParentPortal: React.FC<ParentPortalProps> = ({
  students,
  buses,
  notifications,
  onUpdateStatus,
  currentUser
}) => {
  // Phase 7K — students.parentId is now a real, persisted FK to the
  // logged-in legacy user's id (previously a hardcoded 'par-1' literal
  // that matched no real account at all — see legacyOwnershipAudit.test.ts
  // for that prior, now-closed finding). Session-derived, never a body/URL
  // value the client could spoof.
  const parentStudents = students.filter((s) => s.parentId === currentUser?.id);
  const [selectedStudentId, setSelectedStudentId] = useState<string | undefined>(undefined);

  // BUG FIX: activeStudent used to fall through to `students[0]` — the
  // first student IN THE ENTIRE SYSTEM, regardless of owner — whenever
  // selectedStudentId didn't match one of the parent's own children (e.g.
  // its initial value, or simply because the parent owns zero students).
  // Live-reproduced: a newly self-registered parent (no children linked —
  // there is no assignment mechanism, this is the normal state per Phase
  // 7K's ownership model) was shown a completely unrelated family's child
  // — name, school, absence status, pickup address, and the driver's phone
  // number — as if it were their own. The lookup is now constrained to
  // parentStudents at the point of use, not just at initialization, so a
  // stray/unset selectedStudentId can never resolve to someone else's
  // child. `students.length === 0` (initial mock state, before the first
  // real sync) is the one legitimate case where nothing is owned yet
  // because nothing has loaded yet — that keeps the existing loading
  // message below, not this fix's new "no children" message.
  const activeStudent =
    students.length === 0 ? students[0] : parentStudents.find((s) => s.id === selectedStudentId) || parentStudents[0];
  const assignedBus = buses.find((b) => b.id === activeStudent?.busId);

  const [absenceReason, setAbsenceReason] = useState('');
  const [showAbsenceModal, setShowAbsenceModal] = useState(false);
  const [absenceSubmitted, setAbsenceSubmitted] = useState(false);

  // 5-Minute Pre-Arrival Automatic Notification Scheduler State
  const [isAutoNotifyEnabled, setIsAutoNotifyEnabled] = useState(true);
  const [leadTimeMinutes, setLeadTimeMinutes] = useState<number>(5);
  const [notificationChannel, setNotificationChannel] = useState<'in_app' | 'sms' | 'audio'>('in_app');
  // UX audit finding P1-2: this used to be plain component state, reset on
  // every page reload — a parent who checked the app a few times before
  // pickup would see the exact same "bus is 5 minutes away" alert refire
  // each time, since the dedup key has no per-day scope. Persisted to
  // localStorage under a key scoped to today's date, so a real alert
  // fires at most once per student per day regardless of how many times
  // the page reloads, while still firing again tomorrow.
  const todayKey = `masara_fired_alerts_${new Date().toISOString().slice(0, 10)}`;
  const [firedStudentAlerts, setFiredStudentAlerts] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(todayKey);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduleSuccessMsg, setScheduleSuccessMsg] = useState<string | null>(null);
  const [isNotifyPanelOpen, setIsNotifyPanelOpen] = useState(false);

  // Active Toast Alert Banner state
  const [activePreArrivalToast, setActivePreArrivalToast] = useState<{
    title: string;
    message: string;
    timestamp: string;
    studentName: string;
    busNumber: string;
    eta: number;
  } | null>(null);

  // Automatic live monitor for ETA <= leadTimeMinutes
  useEffect(() => {
    if (!activeStudent || !assignedBus || !isAutoNotifyEnabled) return;

    const currentEta = assignedBus.nextStopEtaMins;
    const alertKey = `${activeStudent.id}-${assignedBus.id}-${leadTimeMinutes}`;

    // Trigger automatic alert when bus ETA drops to or below the scheduled lead time (e.g. 5 mins)
    if (currentEta <= leadTimeMinutes && !firedStudentAlerts[alertKey]) {
      setFiredStudentAlerts((prev) => {
        const next = { ...prev, [alertKey]: true };
        try {
          localStorage.setItem(todayKey, JSON.stringify(next));
        } catch {
          // localStorage unavailable — the in-memory dedup for this session still works
        }
        return next;
      });

      // Dispatch to server notification system
      fetch('/api/notifications/schedule-prearrival', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(currentUser?.sessionToken) },
        body: JSON.stringify({
          studentId: activeStudent.id,
          busId: assignedBus.id,
          minutesBefore: leadTimeMinutes
        })
      }).catch(console.error);

      // Play chime tone
      playChimeSound();

      // Set active floating notification toast
      const nowStr = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
      setActivePreArrivalToast({
        title: `⏰ تنبيه مبكر: الحافلة تبعد ${leadTimeMinutes} دقائق فقط!`,
        message: `تنبيه تلقائي من نظام مَسارَا: الحافلة (${assignedBus.busNumber}) قادمة في الطريق وسوف تصل إلى نقطة التجمع (${activeStudent.pickupPoint.nameAr}) خلال ${currentEta} دقائق. يرجى التجهز للركوب!`,
        timestamp: nowStr,
        studentName: activeStudent.name,
        busNumber: assignedBus.busNumber,
        eta: currentEta
      });
    }
  }, [assignedBus?.nextStopEtaMins, activeStudent?.id, leadTimeMinutes, isAutoNotifyEnabled]);

  if (students.length > 0 && parentStudents.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-2">
        <p className="text-slate-700 font-bold">لا يوجد أبناء مرتبطون بحسابك حالياً</p>
        <p className="text-slate-500 text-sm font-medium">
          يقوم فريق المدرسة بربط الطالب بحساب ولي الأمر الصحيح. الرجاء التواصل مع إدارة المدرسة لإتمام هذا الربط.
        </p>
      </div>
    );
  }

  if (!activeStudent || !assignedBus) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-500 font-medium">
        جاري تحميل بيانات أولياء الأمور والطلاب...
      </div>
    );
  }

  const handleReportAbsence = () => {
    if (activeStudent) {
      onUpdateStatus(activeStudent.id, 'absent');
      setAbsenceSubmitted(true);
      setTimeout(() => {
        setShowAbsenceModal(false);
        setAbsenceSubmitted(false);
      }, 2000);
    }
  };

  // Schedule / Save Auto Notification Settings
  const handleScheduleAutoNotification = async () => {
    setIsScheduling(true);
    try {
      const res = await fetch('/api/notifications/schedule-prearrival', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(currentUser?.sessionToken) },
        body: JSON.stringify({
          studentId: activeStudent.id,
          busId: assignedBus.id,
          minutesBefore: leadTimeMinutes
        })
      });
      const data = await res.json();
      if (data.success) {
        setScheduleSuccessMsg(`تمت جدولة وتأكيد الإشعار التلقائي بنجاح! سيتم تنبيهك قبل وصول الحافلة بـ ${leadTimeMinutes} دقائق إلى (${activeStudent.pickupPoint.nameAr}).`);
        playChimeSound();
        setTimeout(() => setScheduleSuccessMsg(null), 5000);
      }
    } catch (e) {
      console.error(e);
      setScheduleSuccessMsg('تمت الجدولة محلياً بنجاح.');
      setTimeout(() => setScheduleSuccessMsg(null), 4000);
    } finally {
      setIsScheduling(false);
    }
  };

  // Trigger Instant Test Alert
  const handleTestAlertNow = () => {
    playChimeSound();
    const nowStr = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
    setActivePreArrivalToast({
      title: `🔔 [تجربة تنبيه] الحافلة تبعد ${leadTimeMinutes} دقائق عن نقطة التجمع!`,
      message: `هذا نموذج لاختبار التنبيه التلقائي المسبق لولي الأمر للطالب (${activeStudent.name}). الحافلة (${assignedBus.busNumber}) تبعد الآن ${assignedBus.nextStopEtaMins} دقائق تقريباً.`,
      timestamp: nowStr,
      studentName: activeStudent.name,
      busNumber: assignedBus.busNumber,
      eta: assignedBus.nextStopEtaMins
    });

    // Also push to server notifications log
    fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(currentUser?.sessionToken) },
      body: JSON.stringify({
        title: `🔔 [اختبار] تنبيه وصول الحافلة (${assignedBus.busNumber})`,
        message: `اختبار التنبيه التلقائي المسبق قبل ${leadTimeMinutes} دقائق للطالب (${activeStudent.name}).`,
        type: 'alert',
        targetRole: 'parent'
      })
    }).catch(console.error);
  };

  return (
    <div className="space-y-6">

      {/* Floating Active Pre-Arrival Alert Banner (if triggered) */}
      {activePreArrivalToast && (
        <div className="bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 text-slate-950 p-4 sm:p-5 rounded-2xl shadow-xl border-2 border-amber-300 relative animate-bounce-short text-xs font-['Tajawal',sans-serif] z-20">
          <button
            onClick={() => setActivePreArrivalToast(null)}
            className="absolute top-3 left-3 text-slate-900 hover:text-white p-1 rounded-lg bg-black/10 hover:bg-black/20"
            title="إغلاق التنبيه"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-start gap-3 pr-2">
            <div className="p-2.5 bg-slate-950 text-amber-400 rounded-xl shrink-0 shadow-sm border border-amber-400/30">
              <Timer className="w-6 h-6 animate-pulse" />
            </div>

            <div className="space-y-1.5 flex-1">
              <div className="flex items-center gap-2 font-bold text-sm text-slate-950">
                <span>{activePreArrivalToast.title}</span>
                <span className="bg-slate-950 text-amber-300 text-[10px] px-2 py-0.5 rounded-full font-mono">
                  {activePreArrivalToast.timestamp}
                </span>
              </div>
              <p className="text-slate-950 font-medium text-xs leading-relaxed">
                {activePreArrivalToast.message}
              </p>
              <div className="flex items-center gap-3 pt-1">
                <span className="bg-slate-950/90 text-amber-300 font-bold px-2.5 py-1 rounded-lg text-[11px] border border-amber-400/30">
                  ETA المباشر: {activePreArrivalToast.eta} دقيقة ⏱️
                </span>
                <button
                  onClick={() => alert(`تم تأكيد تجهيز الطالب (${activePreArrivalToast.studentName}) واستعداده عند نقطة التجمع.`)}
                  className="bg-slate-950 hover:bg-slate-900 text-white font-bold px-3 py-1 rounded-lg text-[11px] transition-colors shadow-2xs"
                >
                  تأكيد جاهزية الطالب 👦
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Parent Trust Read Model (Phase 5A) — real, governed Journey/Location/ETA data, replacing nothing below (the legacy demo cards stay as-is) */}
      {currentUser?.email && (
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <span>رحلة الطالب المباشرة (بيانات النظام الفعلية)</span>
          </h2>
          <ParentJourneyPanel userEmail={currentUser.email} />
        </div>
      )}

      {/* Student Switcher Banner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
        <div>
          <div className="text-xs font-bold text-blue-600 mb-1 flex items-center gap-1.5">
            <span>تطبيق ولي الأمر - مسارَا الذكي</span>
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">متابعة أبنائي في النقل المدرسي</h2>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {parentStudents.map((std) => {
            const isSelected = std.id === selectedStudentId;
            return (
              <button
                key={std.id}
                onClick={() => setSelectedStudentId(std.id)}
                className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-blue-600 text-white border-blue-700 shadow-sm'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <img
                  src={std.avatar}
                  alt={std.name}
                  className="w-7 h-7 rounded-full object-cover border border-slate-200"
                />
                <div className="text-right">
                  <div>{std.name}</div>
                  <div className="text-[10px] opacity-80 font-normal">{std.grade}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Grid: Student Trip Status & Driver Info */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Student Trip Live Radar Card */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-6 relative overflow-hidden shadow-sm space-y-5 text-slate-900">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 via-emerald-500 to-amber-500"></div>

          <div className="flex flex-wrap items-center justify-between gap-3 pb-5 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <img
                src={activeStudent.avatar}
                alt={activeStudent.name}
                className="w-14 h-14 rounded-2xl object-cover border-2 border-blue-600 shadow-xs"
              />
              <div>
                <h3 className="text-lg font-bold text-slate-900">{activeStudent.name}</h3>
                <p className="text-xs text-slate-500">{activeStudent.schoolName}</p>
                <div className="text-[11px] text-amber-700 font-semibold mt-0.5">
                  رقم المقعد المخصص: {activeStudent.seatNumber}
                </div>
              </div>
            </div>

            {/* Status Badge */}
            <div className="text-right">
              {activeStudent.status === 'boarded' && (
                <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-800 border border-emerald-200/80 px-3 py-1.5 rounded-xl text-xs font-bold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>تم الصعود إلى الحافلة</span>
                </div>
              )}
              {activeStudent.status === 'waiting' && (
                <div className="inline-flex items-center gap-2 bg-amber-50 text-amber-800 border border-amber-200/80 px-3 py-1.5 rounded-xl text-xs font-bold animate-pulse">
                  <Clock className="w-4 h-4 text-amber-600" />
                  <span>الحافلة قادمة في الطريق</span>
                </div>
              )}
              {activeStudent.status === 'absent' && (
                <div className="inline-flex items-center gap-2 bg-rose-50 text-rose-800 border border-rose-200/80 px-3 py-1.5 rounded-xl text-xs font-bold">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                  <span>مسجل غائب اليوم</span>
                </div>
              )}
            </div>
          </div>

          {/* Live Progress Flow Bar */}
          <div className="py-6 border-b border-slate-100">
            <div className="text-xs font-bold text-slate-600 mb-4 flex items-center justify-between">
              <span>مسار رحلة العودة إلى المنزل (تتبع وكيل مسارَا الذكي)</span>
              <span className="text-blue-700 font-mono font-bold bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                ETA: {assignedBus.nextStopEtaMins} دقائق
              </span>
            </div>

            <div className="relative">
              {/* Connecting Line */}
              <div className="absolute top-1/2 left-0 right-0 h-1.5 bg-slate-100 -translate-y-1/2 rounded-full"></div>
              <div
                className="absolute top-1/2 right-0 h-1.5 bg-gradient-to-l from-blue-600 to-emerald-500 -translate-y-1/2 rounded-full transition-all duration-700"
                style={{
                  width:
                    activeStudent.status === 'boarded'
                      ? '65%'
                      : activeStudent.status === 'at_school'
                      ? '100%'
                      : '20%'
                }}
              ></div>

              {/* Progress Nodes */}
              <div className="relative z-10 flex items-center justify-between">
                <div className="text-center">
                  <div className="w-9 h-9 rounded-full bg-blue-600 border-2 border-white text-white flex items-center justify-center text-xs font-bold mx-auto shadow-sm">
                    🏫
                  </div>
                  <div className="text-[11px] font-bold text-slate-800 mt-2">المدرسة</div>
                  <div className="text-[10px] text-slate-500">الانطلاق: 06:30 ص</div>
                </div>

                <div className="text-center">
                  <div
                    className={`w-10 h-10 rounded-full border-2 text-white flex items-center justify-center text-sm font-bold mx-auto shadow-md transition-all ${
                      activeStudent.status === 'boarded'
                        ? 'bg-amber-500 border-amber-300 animate-bounce'
                        : 'bg-slate-200 border-slate-300 text-slate-600'
                    }`}
                  >
                    🚌
                  </div>
                  <div className="text-[11px] font-bold text-slate-800 mt-2">
                    الحافلة ({assignedBus.busNumber})
                  </div>
                  <div className="text-[10px] text-emerald-700 font-mono font-bold">
                    السرعة: {assignedBus.speedKmH} كم/س
                  </div>
                </div>

                <div className="text-center">
                  <div className="w-9 h-9 rounded-full bg-slate-100 border-2 border-slate-300 text-slate-600 flex items-center justify-center text-xs font-bold mx-auto">
                    🏠
                  </div>
                  <div className="text-[11px] font-bold text-slate-800 mt-2">منزل ولي الأمر</div>
                  <div className="text-[10px] text-slate-500">الوصول المتوقع: 07:05 ص</div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Pickup Location & Details */}
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 flex items-start gap-3">
              <div className="p-2 bg-blue-50 text-blue-700 rounded-lg border border-blue-200">
                <MapPin className="w-4 h-4" />
              </div>
              <div>
                <div className="font-bold text-slate-800">نقطة التوقف المعتمدة</div>
                <div className="text-slate-600 text-[11px] font-medium">{activeStudent.pickupPoint.nameAr}</div>
                <div className="text-slate-500 text-[10px]">{activeStudent.pickupPoint.address}</div>
              </div>
            </div>

            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 flex items-start gap-3">
              <div className="p-2 bg-amber-50 text-amber-700 rounded-lg border border-amber-200">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <div className="font-bold text-slate-800">الوقت المخطط للصعود</div>
                <div className="text-amber-800 font-mono text-sm font-bold">{activeStudent.pickupTimePlanned}</div>
                {activeStudent.pickupTimeActual && (
                  <div className="text-emerald-700 text-[10px] font-semibold">
                    تم الصعود الفعلي: {activeStudent.pickupTimeActual}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Action Buttons for Parent */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={() => setShowAbsenceModal(true)}
              className="flex items-center gap-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-4 py-2.5 rounded-xl text-xs font-bold transition-colors shadow-2xs cursor-pointer"
            >
              <UserX className="w-4 h-4 text-rose-600" />
              <span>الإبلاغ عن غياب الطالب اليوم</span>
            </button>

            <button
              onClick={() => alert('تم إرسال طلب تغيير موقع التوقف الموقت إلى السائق وإدارة النقل.')}
              className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 px-4 py-2.5 rounded-xl text-xs font-bold transition-colors shadow-2xs cursor-pointer"
            >
              <MapPin className="w-4 h-4 text-blue-600" />
              <span>طلب تغيير موقت لنقطة التوقف</span>
            </button>
          </div>
        </div>

        {/* Bus Driver & Safety Card */}
        <div className="space-y-6">
          {/* Driver Info Card */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm text-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <BusIcon className="w-4 h-4 text-blue-600" />
                <span>بيانات سائق الحافلة المباشر</span>
              </h4>
              <span className="bg-emerald-50 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-200">
                مرخص ومفحوص 🛡️
              </span>
            </div>

            <div className="flex items-center gap-3">
              <img
                src={assignedBus.driverAvatar}
                alt={assignedBus.driverName}
                className="w-14 h-14 rounded-2xl object-cover border-2 border-slate-200 shadow-2xs"
              />
              <div>
                <h5 className="font-bold text-sm text-slate-900">{assignedBus.driverName}</h5>
                <p className="text-xs text-slate-500">{assignedBus.busNumber} | لوحة ({assignedBus.plateNumber})</p>
                <div className="flex items-center gap-1 text-[11px] text-amber-700 font-semibold mt-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                  <span>مؤشر الأمان: {assignedBus.safetyScore}%</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <a
                href={`tel:${assignedBus.driverPhone}`}
                className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-2xs transition-colors"
              >
                <Phone className="w-3.5 h-3.5" />
                <span>اتصال بالسائق</span>
              </a>

              <a
                href={`https://wa.me/${assignedBus.driverPhone.replace(/\s+/g, '')}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold py-2.5 rounded-xl text-xs border border-slate-200 transition-colors"
              >
                <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
                <span>واتساب المشرف</span>
              </a>
            </div>
          </div>

          {/* Student Notifications Log */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 shadow-sm text-slate-900">
            <h4 className="font-bold text-xs text-slate-800 flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="flex items-center gap-2">
                <BellRing className="w-4 h-4 text-blue-600" />
                <span>آخر إشعارات ولي الأمر</span>
              </span>
              <span className="text-[10px] text-slate-500">مباشر</span>
            </h4>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {notifications.map((notif) => (
                <div
                  key={notif.id}
                  className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-slate-900">{notif.title}</span>
                    <span className="text-[10px] text-slate-500">{notif.timestamp}</span>
                  </div>
                  <p className="text-slate-600 text-[11px] leading-snug">{notif.message}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 5-Minute Pre-Arrival Automatic Notification Collapsible Panel (at bottom) */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-950 to-blue-950 border border-slate-800 rounded-2xl text-white shadow-lg relative overflow-hidden transition-all">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-400 via-blue-500 to-emerald-400"></div>

        {/* Collapsible Header Toggle */}
        <div className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80">
          <button
            type="button"
            onClick={() => setIsNotifyPanelOpen(!isNotifyPanelOpen)}
            className="flex items-center gap-3 text-right hover:opacity-90 transition-opacity cursor-pointer flex-1 min-w-[280px]"
          >
            <div className="p-2.5 bg-amber-500/20 text-amber-400 rounded-2xl border border-amber-500/30 shrink-0">
              <Timer className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="font-bold text-sm sm:text-base text-white flex items-center gap-2">
                <span>جدولة التنبيه التلقائي لولي الأمر (قبل الوصول بـ ٥ دقائق)</span>
                <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] px-2 py-0.5 rounded-full font-mono">
                  جديدة ⚡
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                تنبيه ذكي يُرسل تلقائياً لولي الأمر عند اقتراب الحافلة بـ {leadTimeMinutes} دقائق من نقطة التجمع الخاصة بـ ({activeStudent.name})
              </p>
            </div>
          </button>

          <div className="flex items-center gap-3">
            {/* Quick Status Tag */}
            <span
              className={`text-xs font-bold px-3 py-1.5 rounded-xl border flex items-center gap-1.5 ${
                isAutoNotifyEnabled
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              <span>{isAutoNotifyEnabled ? `مُفَعَّل (قبل ${leadTimeMinutes} دقائق)` : 'معطل ⚪'}</span>
            </span>

            {/* Expand / Collapse Button */}
            <button
              type="button"
              onClick={() => setIsNotifyPanelOpen(!isNotifyPanelOpen)}
              className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold px-3 py-2 rounded-xl text-xs transition-colors cursor-pointer"
            >
              <span>{isNotifyPanelOpen ? 'إغلاق التفاصيل' : 'فتح وتعديل الإعدادات'}</span>
              {isNotifyPanelOpen ? <ChevronUp className="w-4 h-4 text-amber-400" /> : <ChevronDown className="w-4 h-4 text-amber-400" />}
            </button>
          </div>
        </div>

        {/* Collapsible Content Body */}
        {isNotifyPanelOpen && (
          <div className="p-5 sm:p-6 space-y-4 bg-slate-950/60 animate-fade-in border-t border-slate-800/80">
            {/* Master Toggle Switch */}
            <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800 p-3 rounded-xl">
              <div className="text-xs">
                <span className="font-bold text-slate-200">حالة التنبيه التلقائي للمستقبل:</span>
                <p className="text-slate-400 text-[11px] mt-0.5">إرسال إشعار فوري وتنبيه صوّتي لولي الأمر فور دخول الحافلة نطاق التجمع.</p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-300 px-2">
                  {isAutoNotifyEnabled ? 'مُفَعَّل 🟢' : 'معطل ⚪'}
                </span>
                <button
                  onClick={() => setIsAutoNotifyEnabled(!isAutoNotifyEnabled)}
                  className={`w-12 h-6 rounded-full transition-colors relative p-1 cursor-pointer ${
                    isAutoNotifyEnabled ? 'bg-amber-500' : 'bg-slate-700'
                  }`}
                  title="تفعيل/تعطيل التنبيه التلقائي"
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-slate-950 transition-transform ${
                      isAutoNotifyEnabled ? 'translate-x-0' : '-translate-x-6'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Configuration Row: Lead Time & Notification Channels */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
              {/* Lead Time Selection */}
              <div className="bg-slate-900/70 border border-slate-800/80 p-3.5 rounded-xl space-y-2">
                <label className="font-bold text-slate-200 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <span>تحديد الوقت المسبق للتنبيه:</span>
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { label: '٥ دقائق (الافتراضي)', value: 5 },
                    { label: '١٠ دقائق', value: 10 },
                    { label: '٣ دقائق', value: 3 }
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setLeadTimeMinutes(opt.value)}
                      className={`py-2 px-1 rounded-lg border font-bold text-[11px] transition-all cursor-pointer text-center ${
                        leadTimeMinutes === opt.value
                          ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-xs'
                          : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Delivery Channel Selection */}
              <div className="bg-slate-900/70 border border-slate-800/80 p-3.5 rounded-xl space-y-2">
                <label className="font-bold text-slate-200 flex items-center gap-1.5">
                  <Bell className="w-4 h-4 text-blue-400" />
                  <span>وسيلة وصول التنبيه:</span>
                </label>
                <div className="flex gap-1.5">
                  {[
                    { id: 'in_app', label: 'إشعار النظام وصوت 🔔', icon: Volume2 },
                    { id: 'sms', label: 'رسالة SMS 📱', icon: Smartphone }
                  ].map((ch) => {
                    const IconComp = ch.icon;
                    const isSel = notificationChannel === ch.id;
                    return (
                      <button
                        key={ch.id}
                        type="button"
                        onClick={() => setNotificationChannel(ch.id as any)}
                        className={`flex-1 py-2 px-2 rounded-lg border font-bold text-[11px] flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                          isSel
                            ? 'bg-blue-600 text-white border-blue-400 shadow-xs'
                            : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                        }`}
                      >
                        <IconComp className="w-3.5 h-3.5 shrink-0" />
                        <span>{ch.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ETA Live Status Counter */}
              <div className="bg-slate-900/70 border border-slate-800/80 p-3.5 rounded-xl space-y-2 lg:col-span-1 sm:col-span-2">
                <label className="font-bold text-slate-200 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-emerald-400" />
                    <span>حالة الرادار المباشر:</span>
                  </span>
                  <span className="text-[10px] text-emerald-400 font-mono">تتبع حي GPS</span>
                </label>

                <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 flex items-center justify-between">
                  <div>
                    <div className="text-[11px] text-slate-400">الوقت المتبقي للوصول:</div>
                    <div className="text-amber-400 font-mono font-bold text-sm">
                      ETA: {assignedBus.nextStopEtaMins} دقائق
                    </div>
                  </div>
                  <div>
                    {assignedBus.nextStopEtaMins <= leadTimeMinutes ? (
                      <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold px-2 py-1 rounded-lg animate-pulse">
                        ضمن نطاق التنبيه الـ {leadTimeMinutes} دقائق ⏰
                      </span>
                    ) : (
                      <span className="bg-slate-800 text-slate-300 text-[10px] font-medium px-2 py-1 rounded-lg">
                        مجدول تلقائياً ⏱️
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons & Feedback */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleScheduleAutoNotification}
                  disabled={isScheduling || !isAutoNotifyEnabled}
                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-2 shadow disabled:opacity-50 transition-all cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>تأكيد وجدولة التنبيه التلقائي (قبل {leadTimeMinutes} دقائق)</span>
                </button>

                <button
                  onClick={handleTestAlertNow}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Volume2 className="w-3.5 h-3.5 text-amber-400" />
                  <span>اختبار صوت وإشعار الـ {leadTimeMinutes} دقائق الآن 🔔</span>
                </button>
              </div>

              <div className="text-[11px] text-slate-400">
                نقطة التوقف: <strong className="text-slate-200">{activeStudent.pickupPoint.nameAr}</strong>
              </div>
            </div>

            {scheduleSuccessMsg && (
              <div className="bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 p-3 rounded-xl text-xs font-bold animate-fade-in flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{scheduleSuccessMsg}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Absence Reporting Modal */}
      {showAbsenceModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl text-slate-900 font-['Tajawal',sans-serif]">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-600" />
                <span>الإبلاغ عن غياب الطالب ({activeStudent.name})</span>
              </h3>
              <button
                onClick={() => setShowAbsenceModal(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {absenceSubmitted ? (
              <div className="bg-emerald-50 text-emerald-800 border border-emerald-200 p-4 rounded-xl text-center space-y-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                <div className="font-bold text-sm">تم استلام بلاغ الغياب بنجاح</div>
                <div className="text-xs text-emerald-700">
                  تم إشعار السائق وتعديل محطة التوقف في مسار الذكاء الاصطناعي تلقائياً.
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-slate-600 leading-relaxed">
                  عند تسجيل الغياب، ستقوم خوارزمية مسارَا بتعديل مسار الحافلة وتوفير وقت الانتظار لبقية الطلاب.
                </p>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">سبب الغياب (اختياري)</label>
                  <select
                    value={absenceReason}
                    onChange={(e) => setAbsenceReason(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                  >
                    <option value="عذر مرضي">عذر مرضي</option>
                    <option value="سفر أو ظرف خانق">سفر أو ظرف عائلي</option>
                    <option value="توصيل خاص بواسطة ولي الأمر">توصيل خاص بواسطة ولي الأمر</option>
                  </select>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => setShowAbsenceModal(false)}
                    className="bg-slate-100 text-slate-700 hover:bg-slate-200 px-4 py-2 rounded-xl text-xs font-bold cursor-pointer"
                  >
                    إلغاء
                  </button>
                  <button
                    onClick={handleReportAbsence}
                    className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-xl text-xs font-bold shadow transition-colors cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>تاكيد إرسال البلاغ</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
