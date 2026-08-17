import React, { useEffect, useState } from 'react';
import { AuditEvent } from '../types';
import { getJourneyEvents } from '../services/journeysApi';
import { labelFor, iconFor, colorFor } from '../lib/eventDisplay';
import { AlertCircle, History, RefreshCw } from 'lucide-react';

interface JourneyTimelineProps {
  journeyId: string;
  userEmail: string;
}

// Renders ONLY real audit rows returned by GET /api/journeys/:id/events
// (spec Phase 3B §17) — never fabricates or derives historical steps from
// the journey's current state. Oldest first, exactly as the backend orders it.
export const JourneyTimeline: React.FC<JourneyTimelineProps> = ({ journeyId, userEmail }) => {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError(null);
    getJourneyEvents(journeyId, userEmail)
      .then((data) => setEvents(data))
      .catch((err) => setError(err.message || 'تعذر تحميل سجل أحداث الرحلة الطلابية.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journeyId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-slate-500 text-xs font-medium">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span>جاري تحميل سجل الأحداث...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-800 text-xs flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </span>
        <button onClick={load} className="font-bold underline shrink-0">
          إعادة المحاولة
        </button>
      </div>
    );
  }

  if (!events || events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-slate-400 text-xs font-medium">
        <History className="w-6 h-6" />
        <span>لا يوجد سجل أحداث بعد لهذه الرحلة الطلابية.</span>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {events.map((ev) => (
        <div key={ev.id} className="flex items-start gap-3">
          <div className={`p-1.5 rounded-lg border shrink-0 ${colorFor(ev.eventType)}`}>{iconFor(ev.eventType)}</div>
          <div className="flex-1 min-w-0 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-xs text-slate-900">{labelFor(ev.eventType)}</span>
              <span className="text-[10px] text-slate-500 font-mono shrink-0">
                {new Date(ev.createdAt).toLocaleString('ar-SA', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
              </span>
            </div>
            {ev.operatorDecision && <p className="text-[11px] text-slate-600 mt-1">{ev.operatorDecision}</p>}
            <div className="text-[10px] text-slate-400 mt-1">
              {ev.actorType === 'system' ? 'النظام الذكي' : ev.actorType === 'driver' ? 'السائق' : ev.actorType === 'school' ? 'إدارة المدرسة' : 'المشرف'}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
