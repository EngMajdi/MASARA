import React, { useEffect, useState } from 'react';
import { EtaAccuracyView } from '../types';
import { getEtaAccuracySummary } from '../services/etaAccuracyApi';
import { Target, AlertTriangle, Inbox, RefreshCw } from 'lucide-react';

interface EtaAccuracyPanelProps {
  userEmail: string;
}

const POLL_MS = 15000;

const SOURCE_MIX_LABELS: Record<string, string> = {
  TELEMETRY: 'بيانات حقيقية (Live)',
  SIMULATION: 'محاكاة (Simulation)',
  MIXED: 'مختلطة (Live + محاكاة)',
  NONE: '—',
};

const SOURCE_MIX_STYLES: Record<string, string> = {
  TELEMETRY: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  SIMULATION: 'bg-amber-50 border-amber-200 text-amber-800',
  MIXED: 'bg-blue-50 border-blue-200 text-blue-800',
  NONE: 'bg-slate-100 border-slate-300 text-slate-500',
};

const CONFIDENCE_LABELS: Record<string, string> = { HIGH: 'عالية', MEDIUM: 'متوسطة', LOW: 'منخفضة' };

function formatSeconds(seconds: number | null): string {
  if (seconds == null) return '—';
  const sign = seconds > 0 ? '+' : seconds < 0 ? '−' : '';
  const abs = Math.abs(seconds);
  return abs < 60 ? `${sign}${Math.round(abs)} ث` : `${sign}${(abs / 60).toFixed(1)} د`;
}

function formatPercentage(pct: number | null): string {
  return pct == null ? '—' : `${pct.toFixed(0)}%`;
}

// ETA Accuracy Validation panel (Phase 4E) — compares Phase 4D's live ETA
// against the one authoritative "actual arrival" fact this domain has
// (a driver-triggered Journey drop-off). Deliberately shows "لا تتوفر عينات"
// rather than a fabricated 0% when there is no data yet — measurableSamples
// is always rendered alongside every average/percentage.
export const EtaAccuracyPanel: React.FC<EtaAccuracyPanelProps> = ({ userEmail }) => {
  const [view, setView] = useState<EtaAccuracyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    getEtaAccuracySummary(userEmail)
      .then((data) => {
        setView(data);
        setError(null);
      })
      .catch((err) => setError(err.message || 'تعذر تحميل تقرير دقة تقديرات وقت الوصول.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setLoading(true);
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail]);

  if (loading && !view) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-slate-500 text-xs font-medium">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span>جاري حساب تقرير دقة تقديرات وقت الوصول...</span>
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

  if (!view || view.measurableSamples === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-slate-400 text-xs font-medium">
        <Inbox className="w-6 h-6" />
        <span>لا تتوفر عينات تحقق من دقة تقدير وقت الوصول بعد.</span>
        {view && view.totalCandidates > 0 && (
          <span className="text-slate-400">({view.totalCandidates} تقدير بانتظار وصول فعلي للتحقق منه)</span>
        )}
      </div>
    );
  }

  const within5 = view.bands.find((b) => b.withinSeconds === 300) ?? null;
  const within10 = view.bands.find((b) => b.withinSeconds === 600) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${SOURCE_MIX_STYLES[view.sourceMix]}`}>
          مصدر البيانات: {SOURCE_MIX_LABELS[view.sourceMix]}
        </span>
        <span className="text-[10px] text-slate-500 font-medium">
          التغطية: {formatPercentage(view.coverage != null ? view.coverage * 100 : null)} ({view.measurableSamples} من {view.totalCandidates})
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <div className="text-slate-500">عدد العينات</div>
          <div className="font-bold text-slate-900 text-sm">{view.measurableSamples}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <div className="text-slate-500">متوسط الخطأ المطلق (MAE)</div>
          <div className="font-bold text-slate-900 text-sm">{formatSeconds(view.maeSeconds)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <div className="text-slate-500">الانحياز (Bias)</div>
          <div className="font-bold text-slate-900 text-sm" title="موجب = التقدير يتوقع وصولاً أبطأ من الواقع">
            {formatSeconds(view.biasSeconds)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <div className="text-slate-500">ضمن ±5 دقائق</div>
          <div className="font-bold text-slate-900 text-sm">
            {formatPercentage(within5?.percentage ?? null)} <span className="text-slate-400 font-normal">({within5?.sampleCount ?? 0})</span>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <div className="text-slate-500">ضمن ±10 دقائق</div>
          <div className="font-bold text-slate-900 text-sm">
            {formatPercentage(within10?.percentage ?? null)} <span className="text-slate-400 font-normal">({within10?.sampleCount ?? 0})</span>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <div className="text-slate-500">إجمالي المرشحين</div>
          <div className="font-bold text-slate-900 text-sm">{view.totalCandidates}</div>
        </div>
      </div>

      {view.byConfidence.length > 0 && (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-600 flex items-center gap-1.5">
            <Target className="w-3 h-3" />
            <span>التوزيع حسب مستوى الثقة</span>
          </div>
          <div className="divide-y divide-slate-100">
            {view.byConfidence.map((g) => (
              <div key={g.group} className="flex items-center justify-between px-3 py-1.5 text-[11px]">
                <span className="font-bold text-slate-700">{CONFIDENCE_LABELS[g.group] ?? g.group}</span>
                <span className="text-slate-500">
                  {g.sampleCount} عينة — متوسط الخطأ {formatSeconds(g.maeSeconds)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
