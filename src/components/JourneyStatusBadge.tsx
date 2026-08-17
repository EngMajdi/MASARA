import React from 'react';
import { JourneyState } from '../types';
import { journeyStateLabel, journeyStateIcon, journeyStateColor } from '../lib/eventDisplay';

interface JourneyStatusBadgeProps {
  state: JourneyState;
  className?: string;
}

// Status is never conveyed by color alone (spec §64) — icon + Arabic label +
// color always travel together, everywhere a Journey state is shown.
export const JourneyStatusBadge: React.FC<JourneyStatusBadgeProps> = ({ state, className = '' }) => (
  <span
    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold ${journeyStateColor(
      state
    )} ${className}`}
  >
    {journeyStateIcon(state)}
    <span>{journeyStateLabel(state)}</span>
  </span>
);
