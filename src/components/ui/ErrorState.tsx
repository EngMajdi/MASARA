import React from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from './Button';

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
  className?: string;
}

/** Consistent error language across the whole product — never a raw exception message or stack trace. */
export const ErrorState: React.FC<ErrorStateProps> = ({ message = 'تعذّر تحميل هذه المعلومات.', onRetry, className = '' }) => (
  <div className={`flex flex-col items-center justify-center text-center py-10 px-6 ${className}`}>
    <div className="w-14 h-14 rounded-2xl bg-danger-soft text-danger flex items-center justify-center mb-4">
      <AlertCircle className="w-7 h-7" />
    </div>
    <p className="text-sm text-text-secondary mb-4">{message}</p>
    {onRetry && (
      <Button variant="secondary" size="sm" onClick={onRetry}>
        إعادة المحاولة
      </Button>
    )}
  </div>
);
