import React from 'react';
import { ChevronRight } from 'lucide-react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  onBack?: () => void;
  className?: string;
}

/** The top of every page/section — one consistent title pattern instead of ad hoc banners per screen. */
export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, action, onBack, className = '' }) => (
  <div className={`flex items-center justify-between gap-3 ${className}`}>
    <div className="flex items-center gap-2 min-w-0">
      {onBack && (
        <button onClick={onBack} className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-text-secondary hover:bg-slate-100" title="رجوع">
          <ChevronRight className="w-5 h-5" />
        </button>
      )}
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold text-text-primary truncate">{title}</h1>
        {subtitle && <p className="text-sm text-text-secondary mt-0.5">{subtitle}</p>}
      </div>
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);

export const SectionHeader: React.FC<{ title: string; action?: React.ReactNode; className?: string }> = ({ title, action, className = '' }) => (
  <div className={`flex items-center justify-between gap-3 mb-3 ${className}`}>
    <h2 className="text-base font-bold text-text-primary">{title}</h2>
    {action}
  </div>
);
