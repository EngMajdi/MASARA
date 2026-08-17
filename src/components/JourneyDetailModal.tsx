import React from 'react';
import { Journey } from '../types';
import { JourneyStatusBadge } from './JourneyStatusBadge';
import { JourneyTimeline } from './JourneyTimeline';
import { X, History, Clock } from 'lucide-react';

interface JourneyDetailModalProps {
  journey: Journey;
  studentName: string;
  userEmail: string;
  onClose: () => void;
}

// Reusable Journey detail/timeline view (spec Phase 3B §17/§43) — used by
// both the School Journey Operations Panel and the Driver Journey Console,
// so the timeline is built exactly once, not duplicated per surface.
export const JourneyDetailModal: React.FC<JourneyDetailModalProps> = ({ journey, studentName, userEmail, onClose }) => {
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto font-['Tajawal',sans-serif]"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-50 text-blue-700 rounded-xl border border-blue-200">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-black text-sm text-slate-900">{studentName}</h3>
              <p className="text-[11px] text-slate-500">سجل رحلة الطالب الكامل</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1" aria-label="إغلاق">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl p-3">
            <span className="text-xs font-bold text-slate-600">الحالة الحالية:</span>
            <JourneyStatusBadge state={journey.state} />
          </div>

          {(journey.missedReason || journey.cancelReason || journey.incidentReason) && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-start gap-2">
              <Clock className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              <span>{journey.missedReason || journey.cancelReason || journey.incidentReason}</span>
            </div>
          )}

          <div>
            <h4 className="text-xs font-bold text-slate-700 mb-2.5 flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-blue-600" />
              <span>السجل الزمني للرحلة</span>
            </h4>
            <JourneyTimeline journeyId={journey.id} userEmail={userEmail} />
          </div>
        </div>
      </div>
    </div>
  );
};
