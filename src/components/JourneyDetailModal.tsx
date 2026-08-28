import React from 'react';
import { Journey } from '../types';
import { JourneyStatusBadge } from './JourneyStatusBadge';
import { JourneyTimeline } from './JourneyTimeline';
import { History } from 'lucide-react';
import { Sheet, Alert } from './ui';

interface JourneyDetailModalProps {
  journey: Journey;
  studentName: string;
  sessionToken: string;
  onClose: () => void;
}

// Reusable Journey detail/timeline view (spec Phase 3B §17/§43) — used by
// both the School Journey Operations Panel and the Driver Journey Console,
// so the timeline is built exactly once, not duplicated per surface.
export const JourneyDetailModal: React.FC<JourneyDetailModalProps> = ({ journey, studentName, sessionToken, onClose }) => {
  return (
    <Sheet isOpen onClose={onClose} title={studentName} subtitle="سجل رحلة الطالب الكامل">
      <div className="space-y-4">
        <div className="flex items-center justify-between bg-surface-sunken border border-border-default rounded-xl p-3">
          <span className="text-sm font-bold text-text-secondary">الحالة الحالية:</span>
          <JourneyStatusBadge state={journey.state} />
        </div>

        {(journey.missedReason || journey.cancelReason || journey.incidentReason) && (
          <Alert tone="warning" title={journey.missedReason || journey.cancelReason || journey.incidentReason || ''} />
        )}

        <div>
          <h4 className="text-sm font-bold text-text-primary mb-2.5 flex items-center gap-1.5">
            <History className="w-4 h-4 text-primary" />
            <span>السجل الزمني للرحلة</span>
          </h4>
          <JourneyTimeline journeyId={journey.id} sessionToken={sessionToken} />
        </div>
      </div>
    </Sheet>
  );
};
