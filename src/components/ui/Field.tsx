import React from 'react';

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

/** Wraps one input with a consistent label / helper-text / error pattern. */
export const Field: React.FC<FieldProps> = ({ label, hint, error, required, children, className = '' }) => (
  <div className={className}>
    <label className="block text-sm font-bold text-text-primary mb-1.5">
      {label}
      {required && <span className="text-danger"> *</span>}
    </label>
    {children}
    {hint && !error && <p className="text-xs text-text-secondary mt-1.5">{hint}</p>}
    {error && <p className="text-xs text-danger mt-1.5 font-medium">{error}</p>}
  </div>
);

const inputBase =
  'w-full h-11 px-3.5 bg-slate-50 border rounded-xl text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:bg-white focus:border-primary transition-colors';

export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { hasError?: boolean }> = ({ hasError, className = '', ...rest }) => (
  <input className={`${inputBase} ${hasError ? 'border-danger-border' : 'border-border-default'} ${className}`} {...rest} />
);

export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement> & { hasError?: boolean }> = ({ hasError, className = '', children, ...rest }) => (
  <select className={`${inputBase} ${hasError ? 'border-danger-border' : 'border-border-default'} ${className}`} {...rest}>
    {children}
  </select>
);

export const Textarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement> & { hasError?: boolean }> = ({ hasError, className = '', ...rest }) => (
  <textarea className={`${inputBase} h-auto min-h-[88px] py-2.5 resize-none ${hasError ? 'border-danger-border' : 'border-border-default'} ${className}`} {...rest} />
);

export const FormSection: React.FC<{ title: string; description?: string; children: React.ReactNode; className?: string }> = ({
  title,
  description,
  children,
  className = ''
}) => (
  <div className={`space-y-3 ${className}`}>
    <div>
      <h4 className="font-bold text-sm text-text-primary">{title}</h4>
      {description && <p className="text-xs text-text-secondary mt-0.5">{description}</p>}
    </div>
    {children}
  </div>
);
