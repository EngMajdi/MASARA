import React from 'react';
import { X } from 'lucide-react';

interface SheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * The single "secondary surface" primitive for detail views and drill-downs
 * (a child's journey, a bus's detail, a trip's detail): a bottom sheet on
 * mobile (thumb-reachable, one-handed), a side panel docked to the RTL
 * trailing edge (left) on desktop. This is what "Drawer" and "BottomSheet"
 * collapse into — one adaptive component, not two near-duplicates.
 */
export const Sheet: React.FC<SheetProps> = ({ isOpen, onClose, title, subtitle, children, footer }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-start">
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:w-[440px] max-h-[92vh] sm:max-h-none sm:h-full bg-surface rounded-t-3xl sm:rounded-t-none flex flex-col animate-slide-up sm:animate-slide-in-end shadow-2xl">
        <div className="mx-auto mt-2 w-10 h-1 rounded-full bg-slate-200 sm:hidden" />
        <div className="flex items-center justify-between gap-3 p-4 sm:p-5 border-b border-border-default shrink-0">
          <div className="min-w-0">
            <h3 className="font-bold text-base text-text-primary truncate">{title}</h3>
            {subtitle && <p className="text-xs text-text-secondary mt-0.5 truncate">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-text-secondary hover:bg-slate-100" title="إغلاق">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
        {footer && <div className="shrink-0 p-4 sm:p-5 border-t border-border-default bg-surface pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4">{footer}</div>}
      </div>
    </div>
  );
};
