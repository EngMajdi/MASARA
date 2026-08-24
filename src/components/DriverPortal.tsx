import React, { useState } from 'react';
import { Bus, Student, Route } from '../types';
import { SwipeableCard } from './SwipeableCard';
import { AuthUser } from './AuthModal';
import { DriverJourneyConsole } from './DriverJourneyConsole';
import {
  Navigation,
  CheckCircle2,
  XCircle,
  AlertOctagon,
  Clock,
  Gauge,
  Fuel,
  Users,
  Send,
  Zap,
  Play,
  ArrowRightLeft
} from 'lucide-react';

interface DriverPortalProps {
  buses: Bus[];
  students: Student[];
  routes: Route[];
  onUpdateStatus: (studentId: string, status: 'boarded' | 'absent') => void;
  onTriggerReroute: (busId: string, incident: string) => void;
  onStartRoute?: (busId: string) => void;
  currentUser: AuthUser | null;
}

export const DriverPortal: React.FC<DriverPortalProps> = ({
  buses,
  students,
  routes,
  onUpdateStatus,
  onTriggerReroute,
  onStartRoute,
  currentUser
}) => {
  // Scoped to the logged-in driver's own bus (legacy_buses.driverId,
  // enforced server-side since Phase 7K). BUG FIX: this used to fall back
  // to `buses[0]` — a stranger's bus — whenever the driver owned none,
  // exactly the same class of privacy leak found and fixed in
  // ParentPortal.tsx (a driver with no assigned bus is a real, reachable
  // state, not hypothetical: any future driver account without an
  // assignment would otherwise be shown another driver's bus, students,
  // and route as if it were their own). Only ever fall back while the app
  // is still loading data for the first time (buses.length === 0); once
  // real data has loaded, owning zero buses is treated as its own honest
  // "no bus assigned" state below, never masked by someone else's bus.
  const ownedBus = buses.find((b) => b.driverId === currentUser?.id);
  const activeBus = buses.length === 0 ? buses[0] : ownedBus;
  const activeRoute = activeBus ? routes.find((r) => r.busId === activeBus.id) || routes[0] : routes[0];
  const busStudents = activeBus ? students.filter((s) => s.busId === activeBus.id) : [];

  const [selectedIncident, setSelectedIncident] = useState('حوادث أو أعمال صيانة على شارع السلطان قابوس');
  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [showStartModal, setShowStartModal] = useState(false);
  const [routeStartedToast, setRouteStartedToast] = useState(false);
  const [safetyChecks, setSafetyChecks] = useState({
    busInspection: true,
    seatbelts: true,
    studentsList: true
  });

  if (buses.length > 0 && !ownedBus) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-2">
        <p className="text-slate-700 font-bold">لا توجد حافلة مسندة لحسابك حالياً</p>
        <p className="text-slate-500 text-sm font-medium">
          الرجاء التواصل مع إدارة المدرسة لإتمام إسناد حافلة ومسار لك.
        </p>
      </div>
    );
  }

  if (!activeBus || !activeRoute) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-500 font-medium">
        جاري تحميل بيانات السائق والمسار...
      </div>
    );
  }

  const handleReportIncident = () => {
    if (activeBus) {
      onTriggerReroute(activeBus.id, selectedIncident);
      setShowIncidentModal(false);
    }
  };

  const handleConfirmStartRoute = () => {
    if (onStartRoute && activeBus) {
      onStartRoute(activeBus.id);
    }
    setShowStartModal(false);
    setRouteStartedToast(true);
    setTimeout(() => {
      setRouteStartedToast(false);
    }, 6000);
  };

  return (
    <div className="space-y-6">
      {/* Route Started Success Toast Banner */}
      {routeStartedToast && (
        <div className="bg-emerald-600 text-white p-4 rounded-2xl shadow-lg border border-emerald-500 flex items-center justify-between transition-all animate-in fade-in slide-in-from-top-4">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-xl">
              <CheckCircle2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h4 className="font-bold text-sm">تم إرسال حالة "Route Started" بنجاح 🚀</h4>
              <p className="text-xs text-emerald-100">
                تم بث إشارة انطلاق الرحلة للمسار ({activeRoute.routeNameAr}) لغرفة العمليات الإدارية وأولياء الأمور.
              </p>
            </div>
          </div>
          <button
            onClick={() => setRouteStartedToast(false)}
            className="text-emerald-100 hover:text-white text-xs font-bold px-3 py-1 rounded-lg bg-emerald-700/50 hover:bg-emerald-700 transition-colors"
          >
            إغلاق
          </button>
        </div>
      )}

      {/* Top Banner - Active Driving Session */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4 shadow-sm text-slate-900">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-blue-600 border border-blue-500 flex items-center justify-center text-white text-2xl shadow-sm">
            🚌
          </div>
          <div>
            <div className="text-xs font-bold text-blue-600 flex items-center gap-1.5">
              <Navigation className="w-3.5 h-3.5" />
              <span>تطبيق السائق - الملاحة الذكية الحية</span>
            </div>
            <h2 className="text-xl font-bold text-slate-900">{activeBus.driverName}</h2>
            <p className="text-xs text-slate-500">{activeBus.busNumber} | اللوحة: ({activeBus.plateNumber})</p>
          </div>
        </div>

        {/* Bus Telemetry Stats & Action Buttons */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-xl text-center min-w-[90px]">
            <div className="text-[10px] text-slate-500 flex items-center justify-center gap-1 font-semibold">
              <Gauge className="w-3 h-3 text-emerald-600" />
              <span>السرعة الحالية</span>
            </div>
            <div className="text-sm font-bold text-emerald-700 font-mono">{activeBus.speedKmH} كم/س</div>
          </div>

          <div className="bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-xl text-center min-w-[90px]">
            <div className="text-[10px] text-slate-500 flex items-center justify-center gap-1 font-semibold">
              <Users className="w-3 h-3 text-amber-600" />
              <span>الركاب بالحافلة</span>
            </div>
            <div className="text-sm font-bold text-amber-800 font-mono">
              {activeBus.currentOccupancy} / {activeBus.capacity}
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-xl text-center min-w-[90px]">
            <div className="text-[10px] text-slate-500 flex items-center justify-center gap-1 font-semibold">
              <Fuel className="w-3 h-3 text-sky-600" />
              <span>مستوى الوقود</span>
            </div>
            <div className="text-sm font-bold text-sky-700 font-mono">{activeBus.fuelLevel}%</div>
          </div>

          {/* Start Route Button */}
          <button
            onClick={() => setShowStartModal(true)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md active:scale-95"
          >
            <Play className="w-4 h-4 fill-white" />
            <span>بدء انطلاق الرحلة (Start Route)</span>
          </button>

          <button
            onClick={() => setShowIncidentModal(true)}
            className="flex items-center gap-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-2xs"
          >
            <AlertOctagon className="w-4 h-4 text-amber-600" />
            <span>الإبلاغ عن طارئ</span>
          </button>
        </div>
      </div>

      {/* Journey Core console (Phase 3B) — real backend-governed per-student state, not legacy status toggles */}
      <div>
        <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2 mb-3">
          <Navigation className="w-4 h-4 text-blue-600" />
          <span>متابعة صعود ونزول الطلاب</span>
        </h3>
        {currentUser?.email ? (
          <DriverJourneyConsole userEmail={currentUser.email} />
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-slate-500 text-xs font-medium">
            سجّل الدخول لعرض وحدة تحكم رحلات الطلاب.
          </div>
        )}
      </div>

      {/* Main Grid: Active Next Stop Navigation & Student Check-In Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Next Stop Navigation Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-sm text-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-600" />
              <span>نقطة التوقف القادمة مباشرة</span>
            </h3>
            <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-2.5 py-0.5 rounded text-[10px] font-bold">
              ETA {activeBus.nextStopEtaMins} د
            </span>
          </div>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
            <div className="text-xs text-slate-500 font-medium">اسم محطة التوقف المقترحة:</div>
            <div className="text-base font-bold text-slate-900">{activeBus.nextStopName}</div>
            <div className="text-xs text-slate-600">
              حي القرم - قرب شارع النهضة (مسقط)
            </div>
            <div className="bg-emerald-50 border border-emerald-200 p-2.5 rounded-lg text-emerald-800 text-xs flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>الوكيل الذكي: التوقف مخصص لاستلام طالبين في وقت واحد لتقليل التأخير.</span>
            </div>
          </div>

          {/* Sequence Stops List */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-700">تسلسل محطات المسار الحالية ({activeRoute.routeNameAr})</h4>
            <div className="space-y-2">
              {activeRoute.stops.map((stop, idx) => (
                <div
                  key={stop.id}
                  className={`p-3 rounded-xl border flex items-center justify-between text-xs transition-all ${
                    stop.completed
                      ? 'bg-slate-50 border-slate-200 opacity-60'
                      : idx === 2
                      ? 'bg-amber-50 border-amber-200 text-amber-900'
                      : 'bg-white border-slate-200 text-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-slate-100 border border-slate-200 font-bold flex items-center justify-center text-[10px] text-blue-600">
                      {stop.orderSequence}
                    </span>
                    <div>
                      <div className="font-bold text-slate-900">{stop.nameAr}</div>
                      <div className="text-[10px] text-slate-500">الوقت المستهدف: {stop.estimatedTime}</div>
                    </div>
                  </div>

                  <div>
                    {stop.completed ? (
                      <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded">
                        مكتملة ✅
                      </span>
                    ) : (
                      <span className="bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold px-2 py-0.5 rounded">
                        قادمة ⏳
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Student Boarding Check-In Checklist */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm text-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-base text-slate-900">قائمة حضور الطلاب وصعود الحافلة</h3>
              <p className="text-xs text-slate-500">
                تأكيد صعود الطلاب باللمس أو عبر إيماءة التمرير السريعة في الجوال
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-blue-700 bg-blue-50 px-2.5 py-1 rounded-xl border border-blue-200 font-bold flex items-center gap-1">
                <ArrowRightLeft className="w-3 h-3 text-blue-600" />
                <span>إيماءة الجوال: اسحب لليمين (صعد ✅) | اسحب لليسار (غائب ❌)</span>
              </span>
              <div className="text-xs font-mono font-bold text-blue-700 bg-blue-50 px-3 py-1 rounded-xl border border-blue-200 shrink-0">
                مجموع الطلاب: {busStudents.length}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col justify-between space-y-3 relative overflow-hidden shadow-2xs">
                  <div className="flex items-start gap-3">
                    <img
                      src={std.avatar}
                      alt={std.name}
                      className="w-12 h-12 rounded-xl object-cover border border-slate-200 shrink-0"
                    />
                    <div className="space-y-0.5 min-w-0">
                      <h4 className="font-bold text-sm text-slate-900 truncate">{std.name}</h4>
                      <p className="text-[11px] text-slate-500 truncate">{std.grade}</p>
                      <div className="text-[10px] text-amber-800 font-medium truncate">
                        المقعد: {std.seatNumber} | {std.pickupPoint.nameAr}
                      </div>
                    </div>
                  </div>

                  {/* Status & One-Tap Toggle Buttons */}
                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2">
                    <div className="text-xs">
                      {std.status === 'boarded' && (
                        <span className="text-emerald-700 font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>تم الصعود ({std.pickupTimeActual || 'الان'})</span>
                        </span>
                      )}
                      {std.status === 'waiting' && (
                        <span className="text-amber-700 font-bold flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-amber-600" />
                          <span>ينتظر الصعود</span>
                        </span>
                      )}
                      {std.status === 'absent' && (
                        <span className="text-rose-700 font-bold flex items-center gap-1">
                          <XCircle className="w-3.5 h-3.5 text-rose-600" />
                          <span>غائب</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => onUpdateStatus(std.id, 'boarded')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          std.status === 'boarded'
                            ? 'bg-emerald-600 text-white shadow-2xs'
                            : 'bg-white hover:bg-emerald-600 text-slate-700 hover:text-white border border-slate-200'
                        }`}
                      >
                        صعد ✅
                      </button>

                      <button
                        onClick={() => onUpdateStatus(std.id, 'absent')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          std.status === 'absent'
                            ? 'bg-rose-600 text-white shadow-2xs'
                            : 'bg-white hover:bg-rose-600 text-slate-700 hover:text-white border border-slate-200'
                        }`}
                      >
                        غائب ❌
                      </button>
                    </div>
                  </div>
                </div>
              </SwipeableCard>
            ))}
          </div>
        </div>
      </div>

      {/* Incident / Rerouting Trigger Modal */}
      {showIncidentModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl text-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <AlertOctagon className="w-5 h-5 text-amber-600" />
                <span>الإبلاغ عن عائق مروري أو خطورة طارئة</span>
              </h3>
              <button
                onClick={() => setShowIncidentModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              يقوم وكيل مسارَا (MASARA AI) فور استلام بلاغ السائق بإعادة تخطيط المسار تلقائياً وتحديث خريطة الملاحة وطمأنة أسر الطلاب.
            </p>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700">حدد نوع العائق المروري:</label>
              {[
                'حوادث أو أعمال صيانة على طريق الملك فهد',
                'ازدحام مروري خانق عند دوار حي الياسمين',
                'إغلاق مؤقت لشارع الإمام سعود',
                'عطل ميكانيكي بسيط بالحافلة'
              ].map((incidentOption) => (
                <label
                  key={incidentOption}
                  className={`flex items-center gap-2.5 p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                    selectedIncident === incidentOption
                      ? 'bg-amber-50 border-amber-300 text-amber-900 font-bold'
                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <input
                    type="radio"
                    name="incident"
                    checked={selectedIncident === incidentOption}
                    onChange={() => setSelectedIncident(incidentOption)}
                    className="accent-amber-600"
                  />
                  <span>{incidentOption}</span>
                </label>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowIncidentModal(false)}
                className="bg-slate-100 text-slate-700 hover:bg-slate-200 px-4 py-2 rounded-xl text-xs font-bold"
              >
                إلغاء
              </button>
              <button
                onClick={handleReportIncident}
                className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-2xs transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                <span>تفعيل التوجيه البديل الذكي الآن</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Start Route Confirmation Modal */}
      {showStartModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-lg w-full space-y-5 shadow-2xl relative text-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-emerald-100 text-emerald-700 rounded-xl">
                  <Play className="w-5 h-5 fill-emerald-600" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900">تأكيد انطلاق المسار والرحلة المباشرة</h3>
                  <p className="text-xs text-slate-500">البث المباشر لغرفة العمليات وأولياء الأمور</p>
                </div>
              </div>
              <button
                onClick={() => setShowStartModal(false)}
                className="text-slate-400 hover:text-slate-700 transition-colors"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Route Details Summary Card */}
              <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl space-y-2.5 text-xs">
                <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                  <span className="text-slate-500">اسم الحافلة واللوحة:</span>
                  <span className="font-bold text-slate-900">{activeBus.busNumber} ({activeBus.plateNumber})</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                  <span className="text-slate-500">اسم الكابتن / السائق:</span>
                  <span className="font-bold text-slate-900">{activeBus.driverName}</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                  <span className="text-slate-500">المسار المسند:</span>
                  <span className="font-bold text-blue-700">{activeRoute.routeNameAr}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">إجمالي الطلاب المسجلين بالرحلة:</span>
                  <span className="font-bold text-emerald-700">{busStudents.length} طالب وطالبة</span>
                </div>
              </div>

              {/* Safety Checklist */}
              <div className="bg-amber-50/60 border border-amber-200 p-3.5 rounded-2xl space-y-2 text-xs">
                <h4 className="font-bold text-amber-900 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-amber-600" />
                  <span>قائمة الجاهزية والسلامة قبل الانطلاق:</span>
                </h4>
                <div className="space-y-2 pt-1 text-slate-700">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={safetyChecks.busInspection}
                      onChange={(e) => setSafetyChecks({ ...safetyChecks, busInspection: e.target.checked })}
                      className="rounded accent-emerald-600 w-4 h-4"
                    />
                    <span>تم فحص الوقود والإطارات وجاهزية محرك الحافلة.</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={safetyChecks.seatbelts}
                      onChange={(e) => setSafetyChecks({ ...safetyChecks, seatbelts: e.target.checked })}
                      className="rounded accent-emerald-600 w-4 h-4"
                    />
                    <span>التأكد من أحزمة الأمان ومطافئ الحريق ووسائل السلامة.</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={safetyChecks.studentsList}
                      onChange={(e) => setSafetyChecks({ ...safetyChecks, studentsList: e.target.checked })}
                      className="rounded accent-emerald-600 w-4 h-4"
                    />
                    <span>تطابق قائمة الطلاب ونقاط المحطات مع نظام الملاحة الذكي.</span>
                  </label>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 p-3 rounded-xl text-[11px] text-blue-800 flex items-start gap-2">
                <Zap className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <span>عند الضغط على تأكيد، سيتلقى الإداريون في لوحة التحكم حالة "Route Started" مع بث التنبيهات الفورية لأولياء الأمور.</span>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
              <button
                onClick={() => setShowStartModal(false)}
                className="bg-slate-100 text-slate-700 hover:bg-slate-200 px-4 py-2.5 rounded-xl text-xs font-bold transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={handleConfirmStartRoute}
                disabled={!safetyChecks.busInspection || !safetyChecks.seatbelts || !safetyChecks.studentsList}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-md transition-all"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>تأكيد وانطلاق الرحلة الآن 🚀</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
