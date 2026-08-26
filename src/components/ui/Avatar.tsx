import React from 'react';

type Size = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-14 h-14 text-base',
  xl: 'w-20 h-20 text-2xl'
};

const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '؟';
  return parts[0]!.charAt(0);
};

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: Size;
  ring?: boolean;
  className?: string;
}

/** Image avatar with an initials fallback — never a broken-image icon if the URL 404s. */
export const Avatar: React.FC<AvatarProps> = ({ src, name, size = 'md', ring = false, className = '' }) => {
  const [errored, setErrored] = React.useState(false);
  const showImage = src && !errored;

  return (
    <div
      className={`${SIZE_CLASSES[size]} rounded-full shrink-0 flex items-center justify-center font-bold bg-primary-soft text-primary overflow-hidden ${
        ring ? 'ring-2 ring-white shadow-sm' : ''
      } ${className}`}
    >
      {showImage ? (
        <img src={src} alt={name} className="w-full h-full object-cover" onError={() => setErrored(true)} />
      ) : (
        <span>{initials(name)}</span>
      )}
    </div>
  );
};
