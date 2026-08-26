import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLElement> {
  padding?: 'none' | 'sm' | 'md' | 'lg';
  interactive?: boolean;
  /** Renders as a different element — e.g. "form" so a submit button inside actually submits. */
  as?: 'div' | 'form';
}

const PADDING_CLASSES = { none: '', sm: 'p-3', md: 'p-4 sm:p-5', lg: 'p-5 sm:p-6' };

/** The single card primitive — a plain surface with a border, never a shadow at rest (calm, not "floaty"). */
export const Card: React.FC<CardProps> = ({ padding = 'md', interactive = false, as = 'div', className = '', children, onClick, onKeyDown, ...rest }) => {
  const Comp = as as any;
  // Phase 9C accessibility fix — a real gap found live during the UX audit: every `interactive`
  // card across the app (dozens of them — bus rows, child cards, admin shortcuts) was a bare
  // `<div onClick>`, invisible to keyboard navigation and screen readers alike (no role, not
  // tabbable, Enter/Space did nothing). This makes onClick keyboard-operable and announced
  // correctly by default, without touching any of those call sites.
  const a11yProps =
    interactive && onClick
      ? {
          role: 'button' as const,
          tabIndex: 0,
          onClick,
          onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
            onKeyDown?.(e);
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onClick(e as unknown as React.MouseEvent<HTMLElement>);
            }
          }
        }
      : { onClick, onKeyDown };
  return (
    <Comp
      className={`bg-surface border border-border-default rounded-2xl ${PADDING_CLASSES[padding]} ${
        interactive ? 'transition-colors hover:border-border-strong cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2' : ''
      } ${className}`}
      {...a11yProps}
      {...rest}
    >
      {children}
    </Comp>
  );
};

export const CardHeader: React.FC<{ title: string; subtitle?: string; action?: React.ReactNode; icon?: React.ReactNode; className?: string }> = ({
  title,
  subtitle,
  action,
  icon,
  className = ''
}) => (
  <div className={`flex items-center justify-between gap-3 pb-3 mb-1 border-b border-border-default ${className}`}>
    <div className="flex items-center gap-2.5 min-w-0">
      {icon && <span className="text-primary shrink-0">{icon}</span>}
      <div className="min-w-0">
        <h3 className="font-bold text-sm text-text-primary truncate">{title}</h3>
        {subtitle && <p className="text-xs text-text-secondary truncate">{subtitle}</p>}
      </div>
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);
