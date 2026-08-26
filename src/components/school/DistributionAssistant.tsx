import React, { useMemo, useState } from 'react';
import { Bus } from '../../types';
import { Card, Button, Badge } from '../ui';
import { Sparkles, ChevronDown, ChevronUp, ArrowLeftRight } from 'lucide-react';

interface DistributionAssistantProps {
  buses: Bus[];
}

interface Recommendation {
  source: Bus;
  target: Bus;
  suggestedMove: number;
}

const HIGH_OCCUPANCY = 0.85;
const LOW_OCCUPANCY = 0.7;

/**
 * Smart Distribution Assistant — a real, deterministic, explainable analysis
 * over the school's actual bus capacity/occupancy data. Deliberately NOT a
 * black-box "AI call": every number shown is directly computed from real
 * props, so "why" is always answerable exactly. No confidence percentage is
 * shown because none is statistically meaningful for a threshold rule (spec
 * §20 — never fabricate a confidence score). Advisory only: there is no
 * backend endpoint to reassign a student's bus today (see
 * docs/LIVE_TRACKING_ARCHITECTURE_AUDIT.md §7.2), so this deliberately has
 * no "Approve & apply" action — only a clear recommendation for a human to
 * act on manually via existing tools.
 */
export const DistributionAssistant: React.FC<DistributionAssistantProps> = ({ buses }) => {
  const [expanded, setExpanded] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const { recommendation, totalCapacity, totalOccupancy } = useMemo(() => {
    const withCapacity = buses.filter((b) => b.capacity > 0);
    const totalCapacity = withCapacity.reduce((sum, b) => sum + b.capacity, 0);
    const totalOccupancy = withCapacity.reduce((sum, b) => sum + b.currentOccupancy, 0);

    const over = withCapacity
      .map((b) => ({ bus: b, pct: b.currentOccupancy / b.capacity }))
      .filter((x) => x.pct >= HIGH_OCCUPANCY)
      .sort((a, b) => b.pct - a.pct);
    const under = withCapacity
      .map((b) => ({ bus: b, pct: b.currentOccupancy / b.capacity, free: b.capacity - b.currentOccupancy }))
      .filter((x) => x.pct <= LOW_OCCUPANCY && x.free > 0)
      .sort((a, b) => b.free - a.free);

    let recommendation: Recommendation | null = null;
    if (over.length > 0 && under.length > 0) {
      const source = over[0].bus;
      const target = under[0].bus;
      const excessSeats = Math.round(source.currentOccupancy - source.capacity * LOW_OCCUPANCY);
      const availableSeats = target.capacity - target.currentOccupancy;
      const suggestedMove = Math.max(1, Math.min(excessSeats, availableSeats));
      recommendation = { source, target, suggestedMove };
    }

    return { recommendation, totalCapacity, totalOccupancy };
  }, [buses]);

  const utilizationPct = totalCapacity > 0 ? Math.round((totalOccupancy / totalCapacity) * 100) : 0;

  return (
    <Card padding="none" className="overflow-hidden">
      <button onClick={() => setExpanded((v) => !v)} className="w-full flex items-center justify-between gap-3 p-4 hover:bg-slate-50 transition-colors">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-primary-soft text-primary rounded-xl shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="text-right">
            <div className="font-bold text-sm text-text-primary">مساعد التوزيع الذكي</div>
            <div className="text-xs text-text-secondary">نسبة استخدام السعة الإجمالية: {utilizationPct}%</div>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-text-tertiary shrink-0" /> : <ChevronDown className="w-4 h-4 text-text-tertiary shrink-0" />}
      </button>

      {expanded && (
        <div className="p-4 pt-0 border-t border-border-default animate-fade-in">
          {!recommendation ? (
            <p className="text-sm text-text-secondary py-4 text-center">لا توجد توصية توزيع حالياً — التوزيع الحالي بين الحافلات متوازن.</p>
          ) : (
            <div className="space-y-3 pt-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-danger-soft rounded-xl p-3">
                  <div className="text-xs text-rose-700 font-bold">{recommendation.source.busNumber}</div>
                  <div className="text-lg font-black text-rose-800">
                    {Math.round((recommendation.source.currentOccupancy / recommendation.source.capacity) * 100)}%
                  </div>
                  <div className="text-xs text-rose-700">{recommendation.source.currentOccupancy}/{recommendation.source.capacity} مقعد</div>
                </div>
                <div className="bg-success-soft rounded-xl p-3">
                  <div className="text-xs text-emerald-700 font-bold">{recommendation.target.busNumber}</div>
                  <div className="text-lg font-black text-emerald-800">
                    {Math.round((recommendation.target.currentOccupancy / recommendation.target.capacity) * 100)}%
                  </div>
                  <div className="text-xs text-emerald-700">{recommendation.target.currentOccupancy}/{recommendation.target.capacity} مقعد</div>
                </div>
              </div>

              <div className="flex items-center gap-2 text-sm text-text-primary font-bold bg-surface-sunken rounded-xl p-3">
                <ArrowLeftRight className="w-4 h-4 text-primary shrink-0" />
                <span>
                  التوصية: نقل {recommendation.suggestedMove} طالب مؤهّل من {recommendation.source.busNumber} إلى {recommendation.target.busNumber}
                </span>
              </div>

              <button onClick={() => setShowWhy((v) => !v)} className="text-xs font-bold text-primary flex items-center gap-1">
                لماذا؟ {showWhy ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {showWhy && (
                <div className="text-xs text-text-secondary bg-surface-sunken rounded-xl p-3 space-y-1 animate-fade-in">
                  <p>
                    حافلة {recommendation.source.busNumber} تعمل بنسبة إشغال {Math.round((recommendation.source.currentOccupancy / recommendation.source.capacity) * 100)}% (أعلى من 85%)، بينما حافلة{' '}
                    {recommendation.target.busNumber} تعمل بنسبة {Math.round((recommendation.target.currentOccupancy / recommendation.target.capacity) * 100)}% ولديها{' '}
                    {recommendation.target.capacity - recommendation.target.currentOccupancy} مقعد شاغر.
                  </p>
                  <p className="font-bold text-text-primary">النتيجة المتوقعة: توزيع أكثر توازناً لسعة الأسطول.</p>
                  <p className="text-text-tertiary">هذا تحليل مباشر لبيانات السعة الفعلية — وليس نسبة ثقة إحصائية.</p>
                </div>
              )}

              <Badge tone="neutral">استشاري فقط — لا يوجد تنفيذ تلقائي</Badge>

              {!acknowledged ? (
                <Button variant="secondary" size="sm" fullWidth onClick={() => setAcknowledged(true)}>
                  فهمت — سأراجع هذا يدوياً
                </Button>
              ) : (
                <p className="text-xs text-emerald-700 font-bold text-center">تم الاطلاع على التوصية.</p>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
};
