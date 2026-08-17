import React, { useEffect, useState } from 'react';
import { GovernedRouteStop, JourneyState, JourneyWithStudent, TripWithJourneys } from '../types';
import {
  getDriverTrips,
  getRouteStops,
  startJourney,
  startBoarding,
  boardStudent,
  startTransit,
  approachStop,
  dropOffStudent,
  completeJourney,
  markMissed,
  markIncident,
  cancelJourney,
} from '../services/journeysApi';
import { JourneyStatusBadge } from './JourneyStatusBadge';
import { JourneyDetailModal } from './JourneyDetailModal';
import { CurrentLocationPanel } from './CurrentLocationPanel';
import {
  Bus,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  History,
  MapPin,
  Inbox,
  UserX,
  Siren,
  RotateCcw,
} from 'lucide-react';

interface DriverJourneyConsoleProps {
  userEmail: string;
}

type ActionKey = 'start' | 'start-boarding' | 'board' | 'start-transit' | 'approach-stop' | 'drop-off' | 'complete' | 'missed' | 'incident' | 'cancel';

interface ActionDef {
  key: ActionKey;
  label: string;
  tone: 'primary' | 'danger' | 'muted';
  needsReason?: boolean;
  needsStop?: boolean;
}

const ACTIONS_FOR_STATE: Record<JourneyState, ActionDef[]> = {
  scheduled: [{ key: 'start', label: 'بدء انتظار الطالب', tone: 'primary' }],
  waiting: [
    { key: 'start-boarding', label: 'بدء صعود الطالب', tone: 'primary' },
    { key: 'missed', label: 'تسجيل غياب', tone: 'danger', needsReason: true },
  ],
  boarding: [
    { key: 'board', label: 'تأكيد صعود الطالب', tone: 'primary' },
    { key: 'missed', label: 'تسجيل غياب', tone: 'danger', needsReason: true },
  ],
  on_bus: [
    { key: 'start-transit', label: 'بدء التنقل', tone: 'primary' },
    { key: 'incident', label: 'الإبلاغ عن حادثة', tone: 'danger' },
  ],
  in_transit: [
    { key: 'approach-stop', label: 'الاقتراب من المحطة', tone: 'primary', needsStop: true },
    { key: 'incident', label: 'الإبلاغ عن حادثة', tone: 'danger' },
  ],
  approaching_stop: [
    { key: 'drop-off', label: 'تسجيل نزول الطالب', tone: 'primary', needsStop: true },
    { key: 'incident', label: 'الإبلاغ عن حادثة', tone: 'danger' },
  ],
  dropped_off: [{ key: 'complete', label: 'إنهاء رحلة الطالب', tone: 'primary' }],
  missed: [{ key: 'cancel', label: 'إلغاء رحلة الطالب', tone: 'muted' }],
  completed: [],
  cancelled: [],
  incident: [],
};

const POLL_MS = 4000;

// Integrated into the existing Driver app (spec Phase 3B §12) — NOT a second
// driver portal. Every action re-fetches authoritative state from the
// backend afterward (no optimistic updates); a 409 conflict (someone else
// already moved this journey) surfaces a message and refreshes rather than
// overwriting backend truth (spec §57/§65).
export const DriverJourneyConsole: React.FC<DriverJourneyConsoleProps> = ({ userEmail }) => {
  const [trips, setTrips] = useState<TripWithJourneys[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [stops, setStops] = useState<GovernedRouteStop[]>([]);
  const [selectedStopId, setSelectedStopId] = useState<string>('');
  const [inFlight, setInFlight] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<{ journey: JourneyWithStudent; action: ActionDef } | null>(null);
  const [reasonInput, setReasonInput] = useState('');
  const [toast, setToast] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [detail, setDetail] = useState<JourneyWithStudent | null>(null);

  const loadTrips = () => {
    getDriverTrips(userEmail)
      .then((data) => {
        setTrips(data);
        setError(null);
        setSelectedTripId((prev) => {
          if (prev && data.some((t) => t.trip.id === prev)) return prev;
          const active = data.find((t) => t.trip.status === 'active');
          return (active ?? data[0])?.trip.id ?? null;
        });
      })
      .catch((err) => setError(err.message || 'تعذر تحميل رحلات السائق.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadTrips();
    const interval = setInterval(loadTrips, POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail]);

  const selectedTrip = trips?.find((t) => t.trip.id === selectedTripId) ?? null;

  useEffect(() => {
    if (!selectedTrip) return;
    getRouteStops(selectedTrip.trip.routeId)
      .then((s) => {
        setStops(s);
        setSelectedStopId((prev) => (prev && s.some((st) => st.id === prev) ? prev : s[0]?.id ?? ''));
      })
      .catch(() => setStops([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTrip?.trip.routeId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const runAction = async (journey: JourneyWithStudent, action: ActionDef, reason?: string) => {
    setInFlight((prev) => new Set(prev).add(journey.id));
    try {
      switch (action.key) {
        case 'start':
          await startJourney(journey.id, userEmail);
          break;
        case 'start-boarding':
          await startBoarding(journey.id, userEmail);
          break;
        case 'board':
          await boardStudent(journey.id, userEmail);
          break;
        case 'start-transit':
          await startTransit(journey.id, userEmail);
          break;
        case 'approach-stop':
          await approachStop(journey.id, selectedStopId, userEmail);
          break;
        case 'drop-off':
          await dropOffStudent(journey.id, journey.currentStopId ?? selectedStopId, userEmail);
          break;
        case 'complete':
          await completeJourney(journey.id, userEmail);
          break;
        case 'missed':
          await markMissed(journey.id, reason ?? '', userEmail);
          break;
        case 'incident':
          await markIncident(journey.id, reason, userEmail);
          break;
        case 'cancel':
          await cancelJourney(journey.id, reason, userEmail);
          break;
      }
      setToast({ tone: 'success', message: `تم تنفيذ "${action.label}" لـ ${journey.studentName ?? 'الطالب'} بنجاح.` });
    } catch (err) {
      const typed = err as Error & { status?: number };
      if (typed.status === 409) {
        setToast({ tone: 'error', message: 'تغيّرت حالة هذه الرحلة الطلابية من جهاز آخر — تم تحديث الشاشة بالحالة الحالية.' });
      } else {
        setToast({ tone: 'error', message: typed.message || 'تعذر تنفيذ الإجراء.' });
      }
    } finally {
      setInFlight((prev) => {
        const next = new Set(prev);
        next.delete(journey.id);
        return next;
      });
      loadTrips();
    }
  };

  const handleActionClick = (journey: JourneyWithStudent, action: ActionDef) => {
    if (inFlight.has(journey.id)) return;
    setConfirming({ journey, action });
    setReasonInput('');
  };

  if (loading && !trips) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 flex items-center justify-center gap-2 text-slate-500 text-sm font-medium">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span>جاري تحميل رحلات اليوم...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-rose-800 text-sm flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </span>
        <button onClick={loadTrips} className="font-bold underline shrink-0">
          إعادة المحاولة
        </button>
      </div>
    );
  }

  if (!trips || trips.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 flex flex-col items-center justify-center gap-2 text-slate-400 text-sm font-medium">
        <Inbox className="w-8 h-8" />
        <span>لا توجد رحلة مسندة إليك اليوم.</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {toast && (
        <div
          className={`p-3.5 rounded-2xl shadow-lg border flex items-center justify-between gap-3 text-xs font-bold ${
            toast.tone === 'success' ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-rose-600 text-white border-rose-500'
          }`}
        >
          <span className="flex items-center gap-2">
            {toast.tone === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {toast.message}
          </span>
          <button onClick={() => setToast(null)}>
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {trips.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {trips.map(({ trip, busNumber }) => (
            <button
              key={trip.id}
              onClick={() => setSelectedTripId(trip.id)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold border shrink-0 transition-all min-h-[40px] ${
                selectedTripId === trip.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200'
              }`}
            >
              {busNumber ?? trip.id.slice(0, 8)} ({trip.status === 'active' ? 'نشطة' : trip.status === 'scheduled' ? 'مجدولة' : trip.status})
            </button>
          ))}
        </div>
      )}

      {selectedTrip && (
        <>
          <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-sm">
                <Bus className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-blue-600">وحدة تحكم رحلات الطلاب — Journey Console</div>
                <h2 className="text-lg font-bold text-slate-900">{selectedTrip.busNumber ?? 'حافلة'}</h2>
                <p className="text-xs text-slate-500">{selectedTrip.routeName ?? 'مسار غير محدد'}</p>
              </div>
            </div>

            {stops.length > 0 && (
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                <MapPin className="w-4 h-4 text-blue-600 shrink-0" />
                <label className="text-[10px] text-slate-500 font-bold shrink-0">المحطة الحالية:</label>
                <select
                  value={selectedStopId}
                  onChange={(e) => setSelectedStopId(e.target.value)}
                  className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-500 min-h-[36px]"
                >
                  {stops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.orderSequence}. {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Current Location Projection (Phase 4C) — reads the server-derived projection only, never computed client-side */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <h3 className="text-xs font-bold text-slate-600 mb-2.5 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-blue-600" />
              <span>الموقع الحالي للحافلة</span>
            </h3>
            <CurrentLocationPanel userEmail={userEmail} scope={{ type: 'bus', busId: selectedTrip.trip.busId, label: selectedTrip.busNumber ?? undefined }} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {selectedTrip.journeys.length === 0 && (
              <div className="sm:col-span-2 bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-400 text-xs font-medium">
                لا يوجد طلاب مسجلون بهذه الحافلة بعد.
              </div>
            )}
            {selectedTrip.journeys.map((journey) => {
              const actions = ACTIONS_FOR_STATE[journey.state] ?? [];
              const busy = inFlight.has(journey.id);
              return (
                <div key={journey.id} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="font-bold text-sm text-slate-900 truncate">{journey.studentName ?? 'طالب غير معروف'}</h4>
                      {journey.studentGrade && <p className="text-[10px] text-slate-500">{journey.studentGrade}</p>}
                    </div>
                    <JourneyStatusBadge state={journey.state} />
                  </div>

                  {(journey.missedReason || journey.incidentReason) && (
                    <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                      {journey.missedReason || journey.incidentReason}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {actions.map((action) => (
                      <button
                        key={action.key}
                        disabled={busy || (!!action.needsStop && !selectedStopId)}
                        onClick={() => handleActionClick(journey, action)}
                        className={`min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 ${
                          action.tone === 'primary'
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            : action.tone === 'danger'
                            ? 'bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200'
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                        }`}
                      >
                        {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : action.key === 'incident' ? <Siren className="w-3.5 h-3.5" /> : action.key === 'missed' ? <UserX className="w-3.5 h-3.5" /> : action.key === 'cancel' ? <RotateCcw className="w-3.5 h-3.5" /> : null}
                        <span>{action.label}</span>
                      </button>
                    ))}
                    <button
                      onClick={() => setDetail(journey)}
                      className="min-h-[40px] px-3 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-blue-700 flex items-center gap-1.5"
                    >
                      <History className="w-3.5 h-3.5" />
                      <span>السجل</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Confirmation dialog (spec §58 — "Board Student? [Cancel] [Confirm Boarding]") */}
      {confirming && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-2xl">
            <h3 className="font-bold text-sm text-slate-900">
              {confirming.action.label}؟ <span className="text-slate-500 font-normal">({confirming.journey.studentName ?? 'الطالب'})</span>
            </h3>
            {confirming.action.needsReason && (
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">السبب:</label>
                <input
                  type="text"
                  value={reasonInput}
                  onChange={(e) => setReasonInput(e.target.value)}
                  placeholder="مثال: لم يصل الطالب لنقطة الانتظار"
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-blue-500 min-h-[44px]"
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setConfirming(null)}
                className="min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                إلغاء
              </button>
              <button
                disabled={!!confirming.action.needsReason && !reasonInput.trim()}
                onClick={() => {
                  const { journey, action } = confirming;
                  setConfirming(null);
                  runAction(journey, action, reasonInput.trim() || undefined);
                }}
                className="min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                تأكيد
              </button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <JourneyDetailModal journey={detail} studentName={detail.studentName ?? 'طالب غير معروف'} userEmail={userEmail} onClose={() => setDetail(null)} />
      )}
    </div>
  );
};
