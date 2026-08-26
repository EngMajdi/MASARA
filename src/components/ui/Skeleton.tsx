import React from 'react';

/** Loading placeholders shaped like the real content they precede — never fake/sample data. */
export const SkeletonLine: React.FC<{ width?: string; className?: string }> = ({ width = '100%', className = '' }) => (
  <div className={`h-3.5 rounded-full bg-slate-200 animate-skeleton ${className}`} style={{ width }} />
);

export const SkeletonCircle: React.FC<{ size?: number; className?: string }> = ({ size = 40, className = '' }) => (
  <div className={`rounded-full bg-slate-200 animate-skeleton shrink-0 ${className}`} style={{ width: size, height: size }} />
);

export const SkeletonCard: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`bg-surface border border-border-default rounded-2xl p-4 sm:p-5 space-y-3 ${className}`}>
    <div className="flex items-center gap-3">
      <SkeletonCircle size={44} />
      <div className="flex-1 space-y-2">
        <SkeletonLine width="50%" />
        <SkeletonLine width="30%" />
      </div>
    </div>
    <SkeletonLine width="90%" />
    <SkeletonLine width="70%" />
  </div>
);

export const SkeletonRow: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`flex items-center gap-3 py-2.5 ${className}`}>
    <SkeletonCircle size={32} />
    <SkeletonLine width="40%" />
  </div>
);
