import React, { useEffect, useState } from 'react';
import { EtaEstimateView } from '../types';
import { getFleetEta, getBusEta } from '../services/etaApi';
import { Clock, MapPin, Gauge, Navigation, AlertTriangle, Inbox, RefreshCw } from 'lucide-react';

type Scope = { type: 'fleet' } | { type: 'bus'; busId: string; label?: string };

interface EtaPanelProps {
  userEmail: string;
  scope: Scope;
}

const POLL_MS = 6000;

const STATUS_LABELS: Record<string, string> = {
  ON_TIME: 'ضمن الوقت',
  DELAYED: 'متأخرة',
  STALE: 'بيانات قديمة',
  UNKNOWN: 'غير معروف',
};

const STATUS_STYLES: Record<string, string> = {
  ON_TIME: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  DELAYED: 'bg-amber-50 border-amber-200 text-amber-800',
  STALE: 'bg-slate-100 border-slate-300 text-slate-600',
  UNKNOWN: 'bg-slate-100 border-slate-300 text-slate-500',
};

const CONFIDENCE_LABELS: Record<string, string> = { HIGH: 'عالية', MEDIUM: 'متوسطة', LOW: 'منخفضة' };

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('ar-OM', { hour: '2-digit', minute: '2-digit' });
}

function formatDistance(meters: number | null): string {
  if (meters == null) return '—';
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} كم` : `${Math.round(meters)} م`;
}

// ETA Intelligence panel (Phase 4D §32/§33) — reads ONLY the server-computed
// estimate, never calculates ETA client-side. Deliberately not labeled "AI
// prediction" (spec §51) — this is a deterministic, explainable estimate.
export const EtaPanel: React.FC<EtaPanelProps> = ({ userEmail, scope }) => {
  const [etas, setEtas] = useState<EtaEstimateView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    const request = scope.type === 'fleet' ? getFleetEta(userEmail) : getBusEta(scope.busId, userEmail).then((eta) => [eta]);
    request
      .then((data) => {
        setEtas(data);
        setError(null);
      })
      .catch((err) => setError(err.message || 'تعذر تحميل تقدير وقت الوصول.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setLoading(true);
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail, scope.type === 'bus' ? scope.busId : 'fleet']);

  if (loading && !etas) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-slate-500 text-xs font-medium">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span>جاري حساب تقدير وقت الوصول...</span>
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

  if (!etas || etas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-slate-400 text-xs font-medium">
        <Inbox className="w-6 h-6" />
        <span>لا تتوفر تقديرات وصول حالياً.</span>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {etas.map((eta) => {
        const isLive = eta.status === 'ON_TIME' || eta.status === 'DELAYED';
        return (
          <div key={eta.busId} className={`rounded-xl border px-3.5 py-3 ${STATUS_STYLES[eta.status] ?? STATUS_STYLES.UNKNOWN}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 font-bold text-slate-800 text-xs">
                <Navigation className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span>{scope.type === 'bus' && scope.label ? scope.label : `حافلة ${eta.busId.slice(0, 8)}…`}</span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border bg-white/70">{STATUS_LABELS[eta.status] ?? eta.status}</span>
            </div>

            {isLive ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <div>
                    <div className="text-slate-500">وقت الوصول التالي</div>
                    <div className="font-bold text-slate-800">{formatTime(eta.estimatedArrivalAt)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <div>
                    <div className="text-slate-500">المحطة القادمة</div>
                    <div className="font-bold text-slate-800 truncate">{eta.nextStopName ?? '—'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Navigation className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <div>
                    <div className="text-slate-500">المسافة المتبقية</div>
                    <div className="font-bold text-slate-800">{formatDistance(eta.remainingDistanceMeters)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <div>
                    <div className="text-slate-500">السرعة</div>
                    <div className="font-bold text-slate-800">{eta.currentSpeedKmh ?? eta.effectiveSpeedKmh ?? 0} كم/س</div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">{eta.explanation.reason}</p>
            )}

            <div className="flex items-center justify-between mt-2 pt-2 border-t border-black/5 text-[10px] text-slate-500">
              <span>الثقة: {CONFIDENCE_LABELS[eta.confidence] ?? eta.confidence}</span>
              {eta.delay && eta.delay.classification !== 'ON_TIME' && (
                <span className="font-bold">{eta.delay.classification === 'SIGNIFICANT_DELAY' ? 'تأخر ملحوظ' : 'تأخر بسيط'}</span>
              )}
              <span title={eta.explanation.reason}>{eta.explanation.reason}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};
