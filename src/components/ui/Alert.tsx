import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import type { Tone } from './Badge';

const TONE_CONFIG: Record<Tone, { classes: string; icon: React.ReactNode }> = {
  success: { classes: 'bg-success-soft border-success-border text-emerald-800', icon: <CheckCircle2 className="w-5 h-5 text-emerald-600" /> },
  warning: { classes: 'bg-warning-soft border-warning-border text-amber-800', icon: <AlertTriangle className="w-5 h-5 text-amber-600" /> },
  danger: { classes: 'bg-danger-soft border-danger-border text-rose-800', icon: <XCircle className="w-5 h-5 text-rose-600" /> },
  info: { classes: 'bg-info-soft border-info-border text-sky-800', icon: <Info className="w-5 h-5 text-sky-600" /> },
  neutral: { classes: 'bg-slate-50 border-slate-200 text-slate-700', icon: <Info className="w-5 h-5 text-slate-500" /> }
};

interface AlertProps {
  tone?: Tone;
  title: string;
  description?: string;
  action?: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
}

/** Inline banner for page-level messages — the single alert pattern for the whole product. */
export const Alert: React.FC<AlertProps> = ({ tone = 'info', title, description, action, onDismiss, className = '' }) => {
  const cfg = TONE_CONFIG[tone];
  return (
    <div className={`flex items-start gap-3 p-4 rounded-2xl border ${cfg.classes} ${className}`}>
      <span className="shrink-0 mt-0.5">{cfg.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm">{title}</p>
        {description && <p className="text-sm opacity-90 mt-0.5 leading-relaxed">{description}</p>}
        {action && <div className="mt-2">{action}</div>}
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="shrink-0 opacity-60 hover:opacity-100 p-1 rounded-lg">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
