import React from 'react';
import type { Tone } from './Badge';
import { AlertTriangle, ShieldAlert, HelpCircle } from 'lucide-react';
import { Button } from './Button';

interface ConfirmDialogProps {
  isOpen: boolean;
  tone?: Extract<Tone, 'danger' | 'warning' | 'info'>;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLoading?: boolean;
  children?: React.ReactNode;
}

const TONE_ICON: Record<string, React.ReactNode> = {
  danger: <ShieldAlert className="w-6 h-6 text-danger" />,
  warning: <AlertTriangle className="w-6 h-6 text-warning" />,
  info: <HelpCircle className="w-6 h-6 text-primary" />
};

/**
 * The ONE pattern for safety-critical or irreversible confirmations
 * (starting a trip, reporting an absence, deactivating an account) —
 * always centered, always blocking, never dismissible by accident.
 * Deliberately distinct from Sheet, which is for browsing detail, not
 * for decisions that need full attention.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  tone = 'info',
  title,
  description,
  confirmLabel,
  cancelLabel = 'إلغاء',
  onConfirm,
  onCancel,
  confirmLoading = false,
  children
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface rounded-2xl w-full max-w-sm shadow-2xl p-5 sm:p-6 space-y-4 animate-fade-in">
        <div className="flex items-start gap-3">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${tone === 'danger' ? 'bg-danger-soft' : tone === 'warning' ? 'bg-warning-soft' : 'bg-primary-soft'}`}>
            {TONE_ICON[tone]}
          </div>
          <div className="min-w-0 pt-1">
            <h3 className="font-bold text-base text-text-primary">{title}</h3>
            <p className="text-sm text-text-secondary mt-1 leading-relaxed">{description}</p>
          </div>
        </div>

        {children && <div>{children}</div>}

        <div className="flex gap-2 pt-1">
          <Button variant="secondary" fullWidth onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} fullWidth onClick={onConfirm} loading={confirmLoading}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};
