import React from 'react';

type Tone = 'neutral' | 'primary' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone;
  size?: Size;
  active?: boolean;
  label: string; // required — icon-only buttons must always carry an accessible/hover label
}

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'text-text-secondary hover:bg-slate-100 hover:text-text-primary',
  primary: 'text-primary hover:bg-primary-soft',
  danger: 'text-danger hover:bg-danger-soft'
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'w-9 h-9 rounded-lg [&_svg]:w-4 [&_svg]:h-4',
  md: 'w-11 h-11 rounded-xl [&_svg]:w-5 [&_svg]:h-5',
  lg: 'w-12 h-12 rounded-xl [&_svg]:w-5 [&_svg]:h-5'
};

export const IconButton: React.FC<IconButtonProps> = ({ tone = 'neutral', size = 'md', active = false, label, className = '', children, ...rest }) => {
  return (
    <button
      title={label}
      aria-label={label}
      className={`relative inline-flex items-center justify-center transition-colors border ${
        active ? 'border-primary-border bg-primary-soft text-primary' : `border-border-default ${TONE_CLASSES[tone]}`
      } ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
};
