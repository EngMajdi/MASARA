import React, { useEffect, useState } from 'react';
import { CurrentLocation } from '../types';
import { getFleetCurrentLocations, getBusCurrentLocation } from '../services/currentLocationApi';
import { MapPin, Gauge, Compass, Radio, RefreshCw, Clock, Inbox, AlertTriangle } from 'lucide-react';

type Scope = { type: 'fleet' } | { type: 'bus'; busId: string; label?: string };

interface CurrentLocationPanelProps {
  userEmail: string;
  scope: Scope;
}

const POLL_MS = 5000;

const SOURCE_LABELS: Record<string, string> = {
  DEVICE: 'جهاز حقيقي',
  GPS_PROVIDER: 'مزوّد GPS',
  SIMULATION: 'محاكاة',
};

// Reads ONLY the derived current-location projection (spec Phase 4C §14/§44)
// — never raw telemetry history, never calculated client-side. The server
// remains the sole authority: every poll simply replaces local state with
// whatever the server currently says (spec §46 — no client-side location
// authority, no drag-and-drop, no manual coordinate edits).
export const CurrentLocationPanel: React.FC<CurrentLocationPanelProps> = ({ userEmail, scope }) => {
  const [locations, setLocations] = useState<CurrentLocation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    const request =
      scope.type === 'fleet'
        ? getFleetCurrentLocations(userEmail)
        : getBusCurrentLocation(scope.busId, userEmail).then((loc) => (loc ? [loc] : []));

    request
      .then((data) => {
        setLocations(data);
        setError(null);
      })
      .catch((err) => setError(err.message || 'تعذر تحميل بيانات الموقع الحالي.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setLoading(true);
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail, scope.type === 'bus' ? scope.busId : 'fleet']);

  if (loading && !locations) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-slate-500 text-xs font-medium">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span>جاري تحميل الموقع الحالي...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-800 text-xs flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </span>
        <button onClick={load} className="font-bold underline shrink-0">
          إعادة المحاولة
        </button>
      </div>
    );
  }

  if (!locations || locations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-slate-400 text-xs font-medium">
        <Inbox className="w-6 h-6" />
        <span>لا يوجد موقع حالي معروف بعد.</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {locations.map((loc) => (
        <div
          key={loc.busId}
          className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-xs ${
            loc.freshness === 'FRESH' ? 'bg-emerald-50/50 border-emerald-200' : 'bg-amber-50/50 border-amber-200'
          }`}
        >
          <div className="flex items-center gap-2 font-bold text-slate-800">
            <MapPin className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span>{scope.type === 'bus' && scope.label ? scope.label : `حافلة ${loc.busId.slice(0, 8)}…`}</span>
          </div>
          <div className="font-mono text-xs text-slate-600">
            {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
          </div>
          <div className="flex items-center gap-1 text-slate-600">
            <Gauge className="w-3 h-3 text-emerald-600" />
            <span>{loc.speed ?? 0} كم/س</span>
          </div>
          <div className="flex items-center gap-1 text-slate-600">
            <Compass className="w-3 h-3 text-indigo-600" />
            <span>{loc.heading != null ? `${Math.round(loc.heading)}°` : '—'}</span>
          </div>
          <div className="flex items-center gap-1 text-slate-500">
            <Radio className="w-3 h-3" />
            <span>{SOURCE_LABELS[loc.source] ?? loc.source}</span>
          </div>
          <div className="flex items-center gap-1 text-slate-500">
            <Clock className="w-3 h-3" />
            <span>{new Date(loc.receivedAt).toLocaleTimeString('ar-OM', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          </div>
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-bold border ${
              loc.freshness === 'FRESH' ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-amber-100 text-amber-800 border-amber-300'
            }`}
          >
            {loc.freshness === 'FRESH' ? 'محدّث' : 'قديم'}
          </span>
        </div>
      ))}
    </div>
  );
};
