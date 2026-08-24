import React from 'react';
import { Student, Bus } from '../types';
import { AuthUser } from './AuthModal';
import { CheckCircle2, Clock, MapPin, Bus as BusIcon, Home, School as SchoolIcon, AlertTriangle } from 'lucide-react';

interface ParentStatusSummaryProps {
  students: Student[];
  buses: Bus[];
  currentUser: AuthUser | null;
}

// UX audit finding P1-1: the parent's first screen used to lead with a GPS
// radar map — engineering-tool framing, not "is my child safe" framing.
// This card is now rendered ABOVE the map (see App.tsx) specifically so a
// parent's very first glance answers the "5-second test": child, status,
// bus, ETA — nothing else competing for attention. Ownership-scoped (only
// this parent's own children, server-derived via Phase 7K's parentId FK,
// never a client-side guess) and honest about the empty state — never
// silently blank.
export const ParentStatusSummary: React.FC<ParentStatusSummaryProps> = ({ students, buses, currentUser }) => {
  const myChildren = students.filter((s) => s.parentId === currentUser?.id);

  if (students.length > 0 && myChildren.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3 text-slate-600 text-sm shadow-sm">
        <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
        <span>لا يوجد أبناء مرتبطون بحسابك حالياً — تواصل مع إدارة المدرسة لإتمام الربط.</span>
      </div>
    );
  }

  if (myChildren.length === 0) return null; // still loading initial data — avoid a false "no children" flash

  const statusInfo: Record<Student['status'], { label: string; icon: React.ReactNode; tone: string }> = {
    boarded: { label: 'صعد الحافلة', icon: <CheckCircle2 className="w-4 h-4" />, tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    at_school: { label: 'وصل إلى المدرسة', icon: <SchoolIcon className="w-4 h-4" />, tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    waiting: { label: 'ينتظر الحافلة', icon: <Clock className="w-4 h-4" />, tone: 'bg-amber-50 text-amber-700 border-amber-200' },
    at_home: { label: 'في المنزل', icon: <Home className="w-4 h-4" />, tone: 'bg-slate-100 text-slate-600 border-slate-200' },
    absent: { label: 'غائب اليوم', icon: <AlertTriangle className="w-4 h-4" />, tone: 'bg-rose-50 text-rose-700 border-rose-200' }
  };

  return (
    <div className={`grid grid-cols-1 ${myChildren.length > 1 ? 'sm:grid-cols-2 lg:grid-cols-3' : ''} gap-3`}>
      {myChildren.map((child) => {
        const bus = buses.find((b) => b.id === child.busId);
        const info = statusInfo[child.status];
        return (
          <div key={child.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <img src={child.avatar} alt={child.name} className="w-9 h-9 rounded-full object-cover border border-slate-200 shrink-0" />
                <div className="min-w-0">
                  <div className="font-bold text-slate-900 text-sm truncate">{child.name}</div>
                  <div className="text-[11px] text-slate-500">{child.grade}</div>
                </div>
              </div>
              <span className={`shrink-0 flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full border ${info.tone}`}>
                {info.icon}
                <span>{info.label}</span>
              </span>
            </div>

            {bus ? (
              <div className="flex items-center justify-between text-xs text-slate-600 bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
                <span className="flex items-center gap-1.5 font-bold text-slate-700">
                  <BusIcon className="w-3.5 h-3.5 text-blue-600" />
                  <span>{bus.busNumber}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />
                  <span>الوقت المتوقع للوصول: {bus.nextStopEtaMins} دقيقة</span>
                </span>
              </div>
            ) : (
              <div className="text-[11px] text-slate-400 bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
                لا توجد بيانات حافلة متاحة حالياً.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
