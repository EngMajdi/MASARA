import React, { useEffect, useState } from 'react';
import { GovernedTrip, GpsSimulationSession, SpeedProfile } from '../types';
import {
  startGpsSimulation,
  advanceGpsSimulation,
  pauseGpsSimulation,
  resumeGpsSimulation,
  cancelGpsSimulation,
  resetGpsSimulations,
} from '../services/gpsSimulationApi';
import { Play, Pause, Square, RotateCcw, Loader2, MapPin, Gauge, Compass, Clock, Radio } from 'lucide-react';

interface GpsSimulationPanelProps {
  trips: GovernedTrip[];
  sessionToken: string | undefined;
}

const SPEED_PROFILES: { id: SpeedProfile; label: string }[] = [
  { id: 'STOPPED', label: 'متوقفة (0 كم/س)' },
  { id: 'SLOW', label: 'بطيئة (15 كم/س)' },
  { id: 'NORMAL', label: 'عادية (30 كم/س)' },
  { id: 'FAST', label: 'سريعة (50 كم/س)' },
];

const STATUS_LABELS: Record<string, string> = {
  RUNNING: 'قيد التشغيل',
  PAUSED: 'متوقفة مؤقتاً',
  COMPLETED: 'اكتملت (وصلت للمدرسة)',
  FAILED: 'فشلت',
  CANCELLED: 'ملغاة',
};

const TICK_MS = 1200; // real-time cadence the UI polls at — the simulated clock itself stays deterministic (tickSeconds per advance call), this is purely a demo refresh rate (spec §67 — simple polling, no WebSockets)

// GPS Simulation, integrated into the existing Simulation Center (spec
// Phase 4A §66) rather than a separate dashboard. This is deliberately a
// coordinate/status readout, not a map (spec §33) — no mapping dependency
// is introduced for Phase 4A.
export const GpsSimulationPanel: React.FC<GpsSimulationPanelProps> = ({ trips, sessionToken }) => {
  const [selectedTripId, setSelectedTripId] = useState('');
  const [speedProfile, setSpeedProfile] = useState<SpeedProfile>('NORMAL');
  const [session, setSession] = useState<GpsSimulationSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || session.status !== 'RUNNING') return;
    const interval = setInterval(async () => {
      try {
        const { session: s } = await advanceGpsSimulation(session.id, sessionToken);
        setSession(s);
      } catch (err) {
        setError((err as Error).message);
      }
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [session, sessionToken]);

  async function handleStart() {
    setBusy(true);
    setError(null);
    try {
      const { session: s } = await startGpsSimulation(selectedTripId || trips[0]?.id, sessionToken, { speedProfile });
      setSession(s);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handlePauseResume() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const { session: s } = session.status === 'RUNNING' ? await pauseGpsSimulation(session.id, sessionToken) : await resumeGpsSimulation(session.id, sessionToken);
      setSession(s);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const { session: s } = await cancelGpsSimulation(session.id, sessionToken);
      setSession(s);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    setBusy(true);
    setError(null);
    try {
      await resetGpsSimulations(sessionToken);
      setSession(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const isActive = session && (session.status === 'RUNNING' || session.status === 'PAUSED');

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 text-blue-900 text-xs rounded-xl px-4 py-2.5 flex items-center gap-2">
        <Radio className="w-4 h-4 shrink-0" />
        <span>محاكاة رصد GPS — رصدات موقع محاكاة (SIMULATION) فقط، لا اتصال بجهاز حقيقي، ولا تُغيّر حالة الرحلة الطلابية.</span>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-800 text-sm font-semibold rounded-xl px-4 py-3">{error}</div>}

      {!isActive ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">الرحلة</label>
            <select
              value={selectedTripId}
              onChange={(e) => setSelectedTripId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-semibold"
            >
              <option value="">{trips[0] ? `${trips[0].id.slice(0, 8)}… (تلقائي)` : 'لا توجد رحلات'}</option>
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id.slice(0, 8)}… · حافلة {t.busId.slice(0, 8)}… ({t.status})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">ملف السرعة (Speed Profile)</label>
            <select
              value={speedProfile}
              onChange={(e) => setSpeedProfile(e.target.value as SpeedProfile)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-semibold"
            >
              {SPEED_PROFILES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <button
            disabled={busy || trips.length === 0}
            onClick={handleStart}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            بدء محاكاة GPS
          </button>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs font-bold text-slate-500">
              الرحلة: <span className="text-slate-900 font-mono">{session.tripId.slice(0, 8)}…</span>
            </div>
            <div className="flex items-center gap-1.5 bg-blue-50 text-blue-800 border border-blue-200 px-3 py-1 rounded-full text-xs font-bold">
              <Loader2 className={`w-3.5 h-3.5 ${session.status === 'RUNNING' ? 'animate-spin' : ''}`} />
              {STATUS_LABELS[session.status] ?? session.status}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-center">
            <div className="bg-slate-50 rounded-xl p-3">
              <div className="text-xs font-bold text-slate-500 flex items-center justify-center gap-1">
                <MapPin className="w-3 h-3" /> الموقع
              </div>
              <div className="font-mono text-xs font-black text-slate-900">
                {session.currentLat.toFixed(5)}, {session.currentLng.toFixed(5)}
              </div>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <div className="text-xs font-bold text-slate-500 flex items-center justify-center gap-1">
                <Gauge className="w-3 h-3" /> السرعة
              </div>
              <div className="font-black text-slate-900">{session.lastObservation?.speed ?? 0} كم/س</div>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <div className="text-xs font-bold text-slate-500 flex items-center justify-center gap-1">
                <Compass className="w-3 h-3" /> الاتجاه
              </div>
              <div className="font-black text-slate-900">
                {session.currentHeading != null ? `${Math.round(session.currentHeading)}°` : '—'}
              </div>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <div className="text-xs font-bold text-slate-500 flex items-center justify-center gap-1">
                <Clock className="w-3 h-3" /> الوقت المحاكى
              </div>
              <div className="font-black text-slate-900">
                {new Date(session.simulatedTime).toLocaleTimeString('ar-OM', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 col-span-2 sm:col-span-2">
              <div className="text-xs font-bold text-slate-500">عدد الرصدات (Observations)</div>
              <div className="font-black text-slate-900">{session.sequence}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              disabled={busy || session.status === 'COMPLETED'}
              onClick={handlePauseResume}
              className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-40 text-slate-700 text-sm font-bold py-2.5 rounded-xl"
            >
              {session.status === 'RUNNING' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {session.status === 'RUNNING' ? 'إيقاف مؤقت' : 'استئناف'}
            </button>
            <button
              disabled={busy}
              onClick={handleStop}
              className="flex items-center justify-center gap-1.5 bg-white border border-rose-300 hover:bg-rose-50 text-rose-700 text-sm font-bold py-2.5 px-4 rounded-xl"
            >
              <Square className="w-4 h-4" />
              إيقاف
            </button>
          </div>
        </div>
      )}

      {session && !isActive && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 text-sm text-slate-600">
          انتهت جلسة محاكاة GPS بحالة: <strong className="text-slate-900">{STATUS_LABELS[session.status] ?? session.status}</strong> — إجمالي الرصدات: {session.sequence}
        </div>
      )}

      <button
        disabled={busy}
        onClick={handleReset}
        className="w-full flex items-center justify-center gap-1.5 text-slate-500 hover:text-slate-700 text-xs font-bold py-2"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        إعادة ضبط جميع جلسات محاكاة GPS
      </button>
    </div>
  );
};
