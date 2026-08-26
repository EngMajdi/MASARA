import React from 'react';
import { Radio, Clock, MapPinOff } from 'lucide-react';
import { Badge } from '../ui';
import type { Tone } from '../ui';

export type Freshness = 'FRESH' | 'STALE';

interface LiveStatusBadgeProps {
  freshness: Freshness | null;
  receivedAt?: string | null;
  className?: string;
}

function secondsAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
}

/**
 * The ONE honesty-critical label in the whole live-tracking feature: it
 * only ever says "مباشر" (Live) when the server itself reported FRESH.
 * STALE and "no data" are visually and textually distinct — never silently
 * rendered as if they were the same as live (spec §25/§26).
 */
export const LiveStatusBadge: React.FC<LiveStatusBadgeProps> = ({ freshness, receivedAt, className = '' }) => {
  if (freshness === null) {
    return (
      <Badge tone="neutral" icon={<MapPinOff className="w-3.5 h-3.5" />} className={className}>
        الموقع غير متاح حالياً
      </Badge>
    );
  }

  if (freshness === 'FRESH') {
    const tone: Tone = 'success';
    return (
      <Badge tone={tone} icon={<Radio className="w-3.5 h-3.5" />} className={className}>
        مباشر{receivedAt ? ` — قبل ${secondsAgo(receivedAt)} ث` : ''}
      </Badge>
    );
  }

  return (
    <Badge tone="warning" icon={<Clock className="w-3.5 h-3.5" />} className={className}>
      آخر تحديث معروف{receivedAt ? ` — قبل ${secondsAgo(receivedAt)} ث` : ''}
    </Badge>
  );
};
