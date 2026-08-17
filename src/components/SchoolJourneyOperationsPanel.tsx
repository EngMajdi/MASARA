import React, { useEffect, useState } from 'react';
import { JourneyWithStudent, TripWithJourneySummary } from '../types';
import { getOperationsJourneysOverview, getTripJourneys } from '../services/journeysApi';
import { JourneyStatusBadge } from './JourneyStatusBadge';
import { JourneyDetailModal } from './JourneyDetailModal';
import { JOURNEY_STATE_LABELS } from '../lib/eventDisplay';
import { Bus, Users, RefreshCw, AlertTriangle, ChevronDown, ChevronUp, Radio, Inbox } from 'lucide-react';

interface SchoolJourneyOperationsPanelProps {
  userEmail: string;
}

const POLL_MS = 4000;

// Integrated into the existing School Operations page (spec Phase 3B §6) —
// NOT a new dashboard. All counts come from GET /api/operations/journeys
// (one backend-aggregated call, no client-side N+1); the roster drill-down
// is fetched lazily, only for a trip the user actually expands.
export const SchoolJourneyOperationsPanel: React.FC<SchoolJourneyOperationsPanelProps> = ({ userEmail }) => {
  const [overview, setOverview] = useState<TripWithJourneySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedTripId, setExpandedTripId] = useState<string | null>(null);
  const [roster, setRoster] = useState<Record<string, JourneyWithStudent[] | 'loading' | 'error'>>({});
  const [detail, setDetail] = useState<{ journey: JourneyWithStudent } | null>(null);

  const loadOverview = () => {
    getOperationsJourneysOverview(userEmail)
      .then((data) => {
        setOverview(data);
        setError(null);
      })
      .catch((err) => setError(err.message || 'تعذر تحميل نظرة عمليات الرحلات الطلابية.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadOverview();
    const interval = setInterval(loadOverview, POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail]);

  const loadRoster = (tripId: string) => {
    setRoster((prev) => ({ ...prev, [tripId]: 'loading' }));
    getTripJourneys(tripId, userEmail)
      .then((journeys) => setRoster((prev) => ({ ...prev, [tripId]: journeys })))
      .catch(() => setRoster((prev) => ({ ...prev, [tripId]: 'error' })));
  };

  const toggleExpand = (tripId: string) => {
    if (expandedTripId === tripId) {
      setExpandedTripId(null);
      return;
    }
    setExpandedTripId(tripId);
    loadRoster(tripId);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm text-slate-900">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
          <Radio className="w-4 h-4 text-blue-600" />
          <span>عمليات الرحلات الطلابية المباشرة</span>
        </h3>
        <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          تحديث تلقائي كل {POLL_MS / 1000} ثوانٍ
        </span>
      </div>

      {loading && !overview && (
        <div className="flex items-center justify-center gap-2 py-10 text-slate-500 text-xs font-medium">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>جاري تحميل بيانات الرحلات...</span>
        </div>
      )}

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-800 text-xs flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </span>
          <button onClick={loadOverview} className="font-bold underline shrink-0">
            إعادة المحاولة
          </button>
        </div>
      )}

      {overview && overview.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-slate-400 text-xs font-medium">
          <Inbox className="w-6 h-6" />
          <span>لا توجد رحلات نشطة أو مجدولة حالياً.</span>
        </div>
      )}

      {overview && overview.length > 0 && (
        <div className="space-y-3">
          {overview.map(({ trip, busNumber, routeName, driverName, summary }) => {
            const hasIncident = summary.counts.incident > 0;
            const nonZero = (Object.keys(summary.counts) as (keyof typeof summary.counts)[]).filter((k) => summary.counts[k] > 0);
            const isExpanded = expandedTripId === trip.id;
            const rosterState = roster[trip.id];
            return (
              <div
                key={trip.id}
                className={`border rounded-xl overflow-hidden transition-all ${
                  hasIncident ? 'border-rose-300 bg-rose-50/40' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <button
                  onClick={() => toggleExpand(trip.id)}
                  className="w-full flex flex-wrap items-center justify-between gap-3 p-3.5 text-right"
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-xl ${hasIncident ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700'}`}>
                      <Bus className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                        <span>{busNumber ?? 'حافلة غير محددة'}</span>
                        {hasIncident && (
                          <span className="flex items-center gap-1 text-rose-700 bg-rose-100 border border-rose-300 px-1.5 py-0.5 rounded-full text-[9px] font-bold">
                            <AlertTriangle className="w-3 h-3" />
                            حادثة
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {routeName ?? 'مسار غير محدد'} {driverName ? `— ${driverName}` : ''}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold text-slate-600 bg-white border border-slate-200 px-2 py-1 rounded-full flex items-center gap-1">
                      <Users className="w-3 h-3 text-amber-600" />
                      {summary.totalStudents} طالب
                    </span>
                    {nonZero.map((state) => (
                      <span key={state} className="text-[9px] font-bold text-slate-600 bg-white border border-slate-200 px-2 py-0.5 rounded-full">
                        {JOURNEY_STATE_LABELS[state]}: {summary.counts[state]}
                      </span>
                    ))}
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-200 bg-white p-3.5 space-y-2">
                    {rosterState === 'loading' && (
                      <div className="flex items-center justify-center gap-2 py-4 text-slate-500 text-xs">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>جاري تحميل قائمة الطلاب...</span>
                      </div>
                    )}
                    {rosterState === 'error' && (
                      <div className="text-rose-700 text-xs flex items-center justify-between">
                        <span>تعذر تحميل قائمة الطلاب.</span>
                        <button onClick={() => loadRoster(trip.id)} className="font-bold underline">
                          إعادة المحاولة
                        </button>
                      </div>
                    )}
                    {Array.isArray(rosterState) && rosterState.length === 0 && (
                      <div className="text-slate-400 text-xs text-center py-3">لا يوجد طلاب مسجلون بهذه الحافلة بعد.</div>
                    )}
                    {Array.isArray(rosterState) &&
                      rosterState.map((j) => (
                        <button
                          key={j.id}
                          onClick={() => setDetail({ journey: j })}
                          className="w-full flex items-center justify-between gap-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-right transition-colors"
                        >
                          <span className="text-xs font-bold text-slate-800">{j.studentName ?? 'طالب غير معروف'}</span>
                          <JourneyStatusBadge state={j.state} />
                        </button>
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {detail && (
        <JourneyDetailModal
          journey={detail.journey}
          studentName={detail.journey.studentName ?? 'طالب غير معروف'}
          userEmail={userEmail}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
};
