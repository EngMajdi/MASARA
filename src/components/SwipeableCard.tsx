import React, { useState, useRef } from 'react';
import { Trash2, CheckCircle2, Phone, Eye, XCircle, ArrowRightLeft } from 'lucide-react';

interface SwipeableCardProps {
  children: React.ReactNode;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  leftActionLabel?: string;
  leftActionColor?: 'red' | 'rose' | 'amber';
  leftActionIcon?: React.ReactNode;
  rightActionLabel?: string;
  rightActionColor?: 'emerald' | 'blue' | 'indigo';
  rightActionIcon?: React.ReactNode;
  threshold?: number;
  className?: string;
}

export const SwipeableCard: React.FC<SwipeableCardProps> = ({
  children,
  onSwipeLeft,
  onSwipeRight,
  leftActionLabel = 'حذف السجل',
  leftActionColor = 'rose',
  leftActionIcon = <Trash2 className="w-5 h-5 text-white" />,
  rightActionLabel = 'تأكيد / تفاصيل',
  rightActionColor = 'emerald',
  rightActionIcon = <CheckCircle2 className="w-5 h-5 text-white" />,
  threshold = 75,
  className = ''
}) => {
  const [offsetX, setOffsetX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const startXRef = useRef<number>(0);
  const currentXRef = useRef<number>(0);

  const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    startXRef.current = clientX;
    currentXRef.current = clientX;
    setIsSwiping(true);
  };

  const handleTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isSwiping) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const diff = clientX - startXRef.current;
    
    // Dampen drag effect past threshold
    let clampedDiff = diff;
    if (Math.abs(diff) > 120) {
      clampedDiff = Math.sign(diff) * (120 + (Math.abs(diff) - 120) * 0.3);
    }

    // Only allow swipe left if onSwipeLeft is provided, and right if onSwipeRight is provided
    if (diff < 0 && !onSwipeLeft) clampedDiff = 0;
    if (diff > 0 && !onSwipeRight) clampedDiff = 0;

    setOffsetX(clampedDiff);
  };

  const handleTouchEnd = () => {
    if (!isSwiping) return;
    setIsSwiping(false);

    if (offsetX < -threshold && onSwipeLeft) {
      onSwipeLeft();
    } else if (offsetX > threshold && onSwipeRight) {
      onSwipeRight();
    }

    // Reset position smoothly
    setOffsetX(0);
  };

  // Determine action background styling
  const isSwipingLeft = offsetX < -10;
  const isSwipingRight = offsetX > 10;

  const leftBgClass = leftActionColor === 'rose' || leftActionColor === 'red'
    ? 'bg-rose-600'
    : 'bg-amber-600';

  const rightBgClass = rightActionColor === 'emerald'
    ? 'bg-emerald-600'
    : rightActionColor === 'blue'
    ? 'bg-blue-600'
    : 'bg-indigo-600';

  return (
    <div className={`relative overflow-hidden rounded-2xl select-none group touch-pan-y ${className}`}>
      {/* Background Action Panels revealed during swipe */}
      <div className="absolute inset-0 flex justify-between items-center px-4 rounded-2xl">
        {/* Right Action (revealed when swiping right) */}
        <div
          className={`absolute inset-y-0 left-0 right-1/2 flex items-center justify-start pr-4 pl-4 font-bold text-white text-xs transition-opacity rounded-r-none rounded-l-2xl ${rightBgClass} ${
            isSwipingRight ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="flex items-center gap-2">
            {rightActionIcon}
            <span>{rightActionLabel}</span>
          </div>
        </div>

        {/* Left Action (revealed when swiping left) */}
        <div
          className={`absolute inset-y-0 right-0 left-1/2 flex items-center justify-end pl-4 pr-4 font-bold text-white text-xs transition-opacity rounded-l-none rounded-r-2xl ${leftBgClass} ${
            isSwipingLeft ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="flex items-center gap-2">
            <span>{leftActionLabel}</span>
            {leftActionIcon}
          </div>
        </div>
      </div>

      {/* Swipeable Card Foreground */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleTouchStart}
        onMouseMove={handleTouchMove}
        onMouseUp={handleTouchEnd}
        onMouseLeave={handleTouchEnd}
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: isSwiping ? 'none' : 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)'
        }}
        className="relative z-10 cursor-grab active:cursor-grabbing"
      >
        {children}
      </div>
    </div>
  );
};
