import React from 'react';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

/** Every empty state must explain WHY it's empty and what happens next — never a bare "no data". */
export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action, className = '' }) => (
  <div className={`flex flex-col items-center justify-center text-center py-10 px-6 ${className}`}>
    <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mb-4 [&_svg]:w-7 [&_svg]:h-7">
      {icon}
    </div>
    <h3 className="font-bold text-sm text-text-primary mb-1">{title}</h3>
    {description && <p className="text-sm text-text-secondary max-w-xs leading-relaxed">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);
