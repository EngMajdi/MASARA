import React from 'react';

export interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  count?: number;
}

interface TabsProps {
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
}

/** Segmented tab navigation — desktop section switcher (icon + label). */
export const Tabs: React.FC<TabsProps> = ({ items, activeId, onChange, className = '' }) => (
  <div className={`flex items-center gap-1 bg-slate-100 p-1 rounded-xl ${className}`}>
    {items.map((item) => {
      const isActive = item.id === activeId;
      return (
        <button
          key={item.id}
          onClick={() => onChange(item.id)}
          className={`flex items-center gap-1.5 px-3.5 h-9 rounded-lg text-sm font-bold transition-colors ${
            isActive ? 'bg-white text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          {item.icon}
          <span>{item.label}</span>
          {typeof item.count === 'number' && item.count > 0 && (
            <span className={`text-xs rounded-full px-1.5 ${isActive ? 'bg-primary-soft text-primary' : 'bg-slate-200 text-slate-600'}`}>{item.count}</span>
          )}
        </button>
      );
    })}
  </div>
);

/** Fixed bottom tab bar — the primary navigation surface on mobile for every role. */
export const MobileTabBar: React.FC<TabsProps> = ({ items, activeId, onChange, className = '' }) => (
  <nav
    className={`fixed bottom-0 inset-x-0 z-30 bg-white border-t border-border-default flex items-stretch pb-[env(safe-area-inset-bottom)] sm:hidden ${className}`}
  >
    {items.map((item) => {
      const isActive = item.id === activeId;
      return (
        <button
          key={item.id}
          onClick={() => onChange(item.id)}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] relative ${
            isActive ? 'text-primary' : 'text-text-tertiary'
          }`}
        >
          <span className="relative [&_svg]:w-5 [&_svg]:h-5">
            {item.icon}
            {typeof item.count === 'number' && item.count > 0 && (
              <span className="absolute -top-1 -left-2 bg-danger text-white text-[10px] font-bold min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center">
                {item.count > 9 ? '9+' : item.count}
              </span>
            )}
          </span>
          <span className="text-[11px] font-bold">{item.label}</span>
        </button>
      );
    })}
  </nav>
);
