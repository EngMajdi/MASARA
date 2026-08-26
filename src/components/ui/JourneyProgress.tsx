import React from 'react';
import { Home, Bus as BusIcon, School } from 'lucide-react';

export type JourneyStage = 'home' | 'boarded' | 'school';

interface JourneyProgressProps {
  stage: JourneyStage;
  homeLabel?: string;
  busLabel: string;
  schoolLabel?: string;
  className?: string;
}

/**
 * The visual "can I understand this without reading" journey line:
 * Home ● — Bus ● — School ○, with the completed segment filled.
 * One shared primitive for the parent child-detail view (and reusable
 * anywhere else a simple 3-point journey needs to be shown at a glance).
 */
export const JourneyProgress: React.FC<JourneyProgressProps> = ({ stage, homeLabel = 'المنزل', busLabel, schoolLabel = 'المدرسة', className = '' }) => {
  const stageIndex = stage === 'home' ? 0 : stage === 'boarded' ? 1 : 2;

  const points = [
    { key: 'home', label: homeLabel, icon: <Home className="w-4 h-4" /> },
    { key: 'boarded', label: busLabel, icon: <BusIcon className="w-4 h-4" /> },
    { key: 'school', label: schoolLabel, icon: <School className="w-4 h-4" /> }
  ];

  return (
    <div className={`relative ${className}`}>
      <div className="absolute top-5 left-5 right-5 h-1 bg-slate-100 rounded-full" />
      <div
        className="absolute top-5 right-5 h-1 bg-primary rounded-full transition-all duration-700"
        style={{ width: stageIndex === 0 ? '0%' : stageIndex === 1 ? 'calc(50% - 20px)' : 'calc(100% - 40px)' }}
      />
      <div className="relative flex items-start justify-between">
        {points.map((point, idx) => {
          const isDone = idx < stageIndex;
          const isCurrent = idx === stageIndex;
          return (
            <div key={point.key} className="flex flex-col items-center text-center w-1/3">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center border-2 z-10 ${
                  isDone || isCurrent ? 'bg-primary border-primary text-white' : 'bg-white border-slate-200 text-slate-400'
                } ${isCurrent ? 'ring-4 ring-primary-soft' : ''}`}
              >
                {point.icon}
              </div>
              <span className={`text-xs font-bold mt-2 truncate max-w-full ${isCurrent ? 'text-primary' : 'text-text-secondary'}`}>{point.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
