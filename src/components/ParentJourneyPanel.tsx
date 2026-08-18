import React, { useEffect, useState } from 'react';
import { ParentJourneyEventView, ParentJourneyView } from '../types';
import { getParentJourneys, getParentJourneyEvents } from '../services/parentApi';
import { JourneyStatusBadge } from './JourneyStatusBadge';
import { labelFor, iconFor, colorFor } from '../lib/eventDisplay';
import { Bus, MapPin, Clock, RefreshCw, AlertTriangle, Inbox, Navigation, History, Radio } from 'lucide-react';

interface ParentJourneyPanelProps {
  userEmail: string;
}

const POLL_MS = 7000;

const ETA_STATUS_LABELS: Record<string, string> = {
  ON_TIME: 'ضمن الوقت',
  DELAYED: 'متأخرة',
  STALE: 'بيانات قديمة',
  UNKNOWN: 'غير متاح',
};

function secondsAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('ar-OM', { hour: '2-digit', minute: '2-digit' });
}

/** Reuses the same audit-event pipeline/labels as JourneyTimeline.tsx (Phase 3B) — just against the parent-scoped endpoint. */
const ChildEventsTimeline: React.FC<{ journeyId: string; userEmail: string }> = ({ journeyId, userEmail }) => {
  const [events, setEvents] = useState<ParentJourneyEventView[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getParentJourneyEvents(journeyId, userEmail)
      .then((data) => !cancelled && setEvents(data))
      .catch(() => !cancelled && setEvents([]));
    return () => {
      cancelled = true;
    };
  }, [journeyId, userEmail]);

  if (!events) {
    return <div className="text-[11px] text-slate-400 py-2">جاري تحميل سجل الأحداث...</div>;
  }
  if (events.length === 0) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-slate-400 py-2">
        <History className="w-3.5 h-3.5" />
        <span>لا يوجد سجل أحداث بعد.</span>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {events.map((ev) => (
        <div key={ev.id} className="flex items-start gap-2.5">
          <div className={`p-1 rounded-lg border shrink-0 ${colorFor(ev.eventType)}`}>{iconFor(ev.eventType)}</div>
          <div className="flex-1 min-w-0 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-[11px] text-slate-900">{labelFor(ev.eventType)}</span>
              <span className="text-[10px] text-slate-500 font-mono shrink-0">
                {new Date(ev.occurredAt).toLocaleTimeString('ar-OM', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

const ChildJourneyCard: React.FC<{ view: ParentJourneyView; userEmail: string }> = ({ view, userEmail }) => {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
        <h3 className="font-bold text-sm text-slate-900">{view.child.name}</h3>
        {view.journey ? (
          <JourneyStatusBadge state={view.journey.state} />
        ) : (
          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold border bg-slate-100 text-slate-500 border-slate-300">
            لا توجد رحلة نشطة
          </span>
        )}
      </div>

      {!view.journey ? (
        <div className="flex flex-col items-center justify-center gap-2 py-6 text-slate-400 text-xs font-medium">
          <Inbox className="w-6 h-6" />
          <span>لا توجد رحلة نشطة حالياً لهذا الطالب.</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
              <Bus className="w-4 h-4 text-blue-600 shrink-0" />
              <div>
                <div className="text-slate-500">الحافلة</div>
                <div className="font-bold text-slate-900">{view.bus?.label ?? '—'}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
              <Navigation className="w-4 h-4 text-blue-600 shrink-0" />
              <div>
                <div className="text-slate-500">المسار</div>
                <div className="font-bold text-slate-900">{view.route?.name ?? '—'}</div>
              </div>
            </div>
          </div>

          {/* Location — LIVE / STALE / UNAVAILABLE (spec §16), never a single generic state */}
          <div
            className={`rounded-xl border px-3.5 py-3 text-[11px] ${
              !view.location
                ? 'bg-slate-50 border-slate-200 text-slate-500'
                : view.location.freshness === 'FRESH'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}
          >
            <div className="flex items-center gap-2 font-bold">
              {view.location ? (
                <Radio className={`w-3.5 h-3.5 ${view.location.freshness === 'FRESH' ? 'animate-pulse' : ''}`} />
              ) : (
                <MapPin className="w-3.5 h-3.5" />
              )}
              <span>
                {!view.location
                  ? 'لا تتوفر بيانات الموقع حالياً'
                  : view.location.freshness === 'FRESH'
                  ? 'الموقع مباشر (LIVE)'
                  : 'الموقع غير محدّث (STALE)'}
              </span>
            </div>
            {view.location && (
              <div className="mt-1 text-slate-500">آخر تحديث منذ {secondsAgo(view.location.receivedAt)} ثانية</div>
            )}
          </div>

          {/* ETA — reused as-is from the existing EtaService, never recomputed here */}
          <div className="flex items-center gap-2.5 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3 text-[11px]">
            <Clock className="w-4 h-4 text-blue-600 shrink-0" />
            <div className="flex-1">
              <div className="text-slate-500">وقت الوصول المتوقع</div>
              <div className="font-bold text-slate-900">
                {view.eta && (view.eta.status === 'ON_TIME' || view.eta.status === 'DELAYED')
                  ? formatTime(view.eta.estimatedArrivalAt)
                  : 'غير متاح حالياً'}
              </div>
            </div>
            {view.eta && <span className="text-[10px] font-bold text-slate-500">{ETA_STATUS_LABELS[view.eta.status] ?? view.eta.status}</span>}
          </div>

          <div className="pt-2 border-t border-slate-100">
            <div className="text-[11px] font-bold text-slate-600 mb-2 flex items-center gap-1.5">
              <History className="w-3.5 h-3.5" />
              <span>سجل رحلة الطالب</span>
            </div>
            <ChildEventsTimeline journeyId={view.journey.id} userEmail={userEmail} />
          </div>
        </>
      )}
    </div>
  );
};

// Parent Trust Read Model (Phase 5A) — a thin, read-only composition over
// Journey Core + Current Location Projection + EtaService. Every value
// shown here is exactly what those existing services returned; nothing is
// computed, estimated, or fabricated on the client.
export const ParentJourneyPanel: React.FC<ParentJourneyPanelProps> = ({ userEmail }) => {
  const [views, setViews] = useState<ParentJourneyView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    getParentJourneys(userEmail)
      .then((data) => {
        setViews(data);
        setError(null);
      })
      .catch((err) => setError(err.message || 'تعذر تحميل بيانات رحلة الطالب.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setLoading(true);
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail]);

  if (loading && !views) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-slate-500 text-xs font-medium">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span>جاري تحميل بيانات رحلة الطالب...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-800 text-xs flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </span>
        <button onClick={load} className="font-bold underline shrink-0">
          إعادة المحاولة
        </button>
      </div>
    );
  }

  if (!views || views.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-slate-400 text-xs font-medium">
        <Inbox className="w-6 h-6" />
        <span>لا يوجد أبناء مرتبطون بحسابك حالياً.</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {views.map((view) => (
        <ChildJourneyCard key={view.child.id} view={view} userEmail={userEmail} />
      ))}
    </div>
  );
};
