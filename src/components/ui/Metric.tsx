import React from 'react';
import type { Tone } from './Badge';

const TONE_ICON_BG: Record<Tone, string> = {
  success: 'bg-success-soft text-emerald-600',
  warning: 'bg-warning-soft text-amber-600',
  danger: 'bg-danger-soft text-rose-600',
  info: 'bg-info-soft text-sky-600',
  neutral: 'bg-slate-100 text-slate-500'
};

interface MetricProps {
  icon: React.ReactNode;
  value: React.ReactNode;
  total?: React.ReactNode;
  label: string;
  tone?: Tone;
  emphasize?: boolean;
  onClick?: () => void;
}

/** One KPI tile — the building block of every "operations at a glance" strip (Parent status, School/Admin operations). */
export const Metric: React.FC<MetricProps> = ({ icon, value, total, label, tone = 'neutral', emphasize = false, onClick }) => {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      className={`bg-surface border rounded-2xl p-4 flex items-center gap-3 text-right w-full ${
        emphasize ? 'border-danger-border' : 'border-border-default'
      } ${onClick ? 'hover:border-border-strong transition-colors' : ''}`}
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 [&_svg]:w-5 [&_svg]:h-5 ${TONE_ICON_BG[tone]}`}>{icon}</div>
      <div className="min-w-0">
        <div className="text-xl font-black text-text-primary leading-tight">
          {value}
          {total && <span className="text-sm font-bold text-text-tertiary"> / {total}</span>}
        </div>
        <div className="text-xs text-text-secondary font-bold truncate">{label}</div>
      </div>
    </Comp>
  );
};
