import React from 'react';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_CLASSES: Record<Tone, string> = {
  success: 'bg-success-soft text-emerald-700 border-success-border',
  warning: 'bg-warning-soft text-amber-700 border-warning-border',
  danger: 'bg-danger-soft text-rose-700 border-danger-border',
  info: 'bg-info-soft text-sky-700 border-info-border',
  neutral: 'bg-slate-100 text-slate-600 border-slate-200'
};

interface BadgeProps {
  tone?: Tone;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** A short status label — the ONLY way status should be communicated across MASARA (never raw color alone, never emoji). */
export const Badge: React.FC<BadgeProps> = ({ tone = 'neutral', icon, children, className = '' }) => (
  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold ${TONE_CLASSES[tone]} ${className}`}>
    {icon}
    {children}
  </span>
);

/** A small colored dot + label, for compact inline status (tables, lists). */
export const StatusDot: React.FC<{ tone?: Tone; children: React.ReactNode; className?: string }> = ({ tone = 'neutral', children, className = '' }) => {
  const dotColor: Record<Tone, string> = {
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-rose-500',
    info: 'bg-sky-500',
    neutral: 'bg-slate-400'
  };
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary ${className}`}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor[tone]}`} />
      {children}
    </span>
  );
};
