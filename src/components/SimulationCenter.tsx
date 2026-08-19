import React, { useEffect, useState, useCallback } from 'react';
import {
  X,
  Play,
  Pause,
  RotateCcw,
  Square,
  ShieldAlert,
  Loader2,
  Clock,
  Gauge,
  ExternalLink,
  CheckCircle2,
} from 'lucide-react';
import { AIRecommendation, ActionVerification, AuditEvent, GovernedTrip, ScenarioId, SimulationSession } from '../types';
import {
  advanceSimulation,
  cancelSimulation,
  getSimulation,
  getSimulationEvents,
  listGovernedTrips,
  listSimulations,
  pauseSimulation,
  resetSimulations,
  resumeSimulation,
  startSimulation,
} from '../services/simulationApi';
import { getRecommendation, getRecommendationVerification } from '../services/approvalsApi';
import { labelFor, iconFor, colorFor } from '../lib/eventDisplay';
import { AuthUser } from './AuthModal';
import { GpsSimulationPanel } from './GpsSimulationPanel';

interface SimulationCenterProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AuthUser | null;
  onOpenApprovalCenter: () => void;
}

const SCENARIOS: { id: ScenarioId; label: string; description: string }[] = [
  { id: 'TRAFFIC_DELAY', label: 'ازدحام مروري (Traffic Delay)', description: 'تأخير كبير يستدعي تغيير المسار — خطورة مرتفعة' },
  { id: 'MINOR_DELAY', label: 'تأخير طفيف (Minor Delay)', description: 'تأخير بسيط يستدعي المتابعة فقط — خطورة متوسطة' },
  { id: 'NORMAL_TRIP', label: 'رحلة طبيعية (Normal Trip)', description: 'لا تأخير، لا إجراء مطلوب — خطورة منخفضة' },
  { id: 'SAFETY_INCIDENT', label: 'حادثة سلامة (Safety Incident)', description: 'حادث يستدعي تصعيداً فورياً — خطورة حرجة' },
];

const STATUS_LABELS: Record<string, string> = {
  RUNNING: 'قيد التشغيل',
  PAUSED: 'متوقفة مؤقتاً',
  COMPLETED: 'مكتملة',
  FAILED: 'فشلت',
  CANCELLED: 'ملغاة',
};

export const SimulationCenter: React.FC<SimulationCenterProps> = ({ isOpen, onClose, currentUser, onOpenApprovalCenter }) => {
  // GPS Simulation (Phase 4A) is a deliberately separate mobility/telemetry
  // responsibility from the AI-governance scenario simulator below (spec
  // §5/§19) — kept as its own tab in the SAME modal rather than a second
  // dashboard (spec §66), with its own isolated state via GpsSimulationPanel.
  const [activeTab, setActiveTab] = useState<'scenario' | 'gps'>('scenario');
  const [scenario, setScenario] = useState<ScenarioId>('TRAFFIC_DELAY');
  const [trips, setTrips] = useState<GovernedTrip[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string>('');
  const [session, setSession] = useState<SimulationSession | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [recommendation, setRecommendation] = useState<AIRecommendation | null>(null);
  const [verification, setVerification] = useState<ActionVerification | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (sessionId: string) => {
    try {
      const [s, ev] = await Promise.all([getSimulation(sessionId), getSimulationEvents(sessionId)]);
      setSession(s);
      setEvents(ev);
      if (s.recommendationId && currentUser) {
        const [rec, ver] = await Promise.all([
          getRecommendation(s.recommendationId, currentUser.email).catch(() => null),
          getRecommendationVerification(s.recommendationId, currentUser.email).catch(() => null),
        ]);
        setRecommendation(rec);
        setVerification(ver);
      }
    } catch (err) {
      setError((err as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.email]);

  useEffect(() => {
    if (!isOpen || !currentUser) return;
    listGovernedTrips(currentUser.email).then(setTrips).catch(() => {});
    listSimulations().then((all) => {
      const active = all.find((s) => s.status === 'RUNNING' || s.status === 'PAUSED');
      if (active) {
        setSession(active);
        refresh(active.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!session || session.status === 'COMPLETED' || session.status === 'FAILED' || session.status === 'CANCELLED') return;
    const interval = setInterval(() => refresh(session.id), 3000);
    return () => clearInterval(interval);
  }, [session, refresh]);

  if (!isOpen) return null;

  async function handleStart() {
    if (!currentUser) return;
    setBusy(true);
    setError(null);
    try {
      const { session: s } = await startSimulation(scenario, currentUser.email, selectedTripId || undefined);
      setSession(s);
      setRecommendation(null);
      setVerification(null);
      await refresh(s.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAdvance() {
    if (!currentUser || !session) return;
    setBusy(true);
    setError(null);
    try {
      await advanceSimulation(session.id, currentUser.email);
      await refresh(session.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handlePauseResume() {
    if (!currentUser || !session) return;
    setBusy(true);
    setError(null);
    try {
      const { session: s } = session.status === 'RUNNING'
        ? await pauseSimulation(session.id, currentUser.email)
        : await resumeSimulation(session.id, currentUser.email);
      setSession(s);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!currentUser || !session) return;
    setBusy(true);
    setError(null);
    try {
      const { session: s } = await cancelSimulation(session.id, currentUser.email);
      setSession(s);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    if (!currentUser) return;
    setBusy(true);
    setError(null);
    try {
      await resetSimulations(currentUser.email);
      setSession(null);
      setEvents([]);
      setRecommendation(null);
      setVerification(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const waitingForApproval = session?.lastResult?.waitingForApproval;
  const isCriticalScenario = session?.scenario === 'SAFETY_INCIDENT';
  const isRunningOrPaused = session && (session.status === 'RUNNING' || session.status === 'PAUSED');
  // Advancing while waiting is exactly how the engine re-checks whether the
  // real Approval Center has resolved the recommendation yet — it must stay
  // clickable, not dead-end the session (this is not a step re-run: the
  // waiting step never consumes currentStep, so it's always safe to re-poll).
  const canAdvance = session?.status === 'RUNNING';

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto font-['Tajawal',sans-serif]">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md">
              <Gauge className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-black text-slate-900">محاكاة مَسارَا (Simulation Center)</h2>
              <p className="text-xs text-slate-500 font-medium">بيئة محاكاة حتمية تُشغّل نفس خدمات الإنتاج الحقيقية — لا نتائج وهمية</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg border border-slate-200 hover:bg-rose-50 text-slate-500 hover:text-rose-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab bar: AI-governance scenario simulation vs GPS mobility simulation (Phase 4A) */}
        <div className="flex items-center gap-1.5 px-4 sm:px-6 pt-3 border-b border-slate-200 bg-slate-50/60 shrink-0">
          <button
            onClick={() => setActiveTab('scenario')}
            className={`px-4 py-2 text-xs font-bold rounded-t-lg transition-colors ${
              activeTab === 'scenario' ? 'bg-white text-indigo-700 border border-b-0 border-slate-200' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            محاكاة السيناريوهات (AI Governance)
          </button>
          <button
            onClick={() => setActiveTab('gps')}
            className={`px-4 py-2 text-xs font-bold rounded-t-lg transition-colors ${
              activeTab === 'gps' ? 'bg-white text-blue-700 border border-b-0 border-slate-200' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            محاكاة GPS (Mobility)
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 bg-slate-50/50">
          {activeTab === 'gps' ? (
            currentUser ? (
              <GpsSimulationPanel trips={trips} userEmail={currentUser.email} />
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-500 text-sm">
                سجّل الدخول لاستخدام محاكاة GPS.
              </div>
            )
          ) : (
            <>
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 text-sm font-semibold rounded-xl px-4 py-3">{error}</div>
          )}

          {isCriticalScenario && (
            <div className="bg-rose-100 border-2 border-rose-300 text-rose-900 rounded-xl px-4 py-3 flex items-center gap-2 font-black text-sm">
              <ShieldAlert className="w-5 h-5" />
              ⚠ حادثة سلامة حرجة (CRITICAL SAFETY EVENT) — يلزم قرار بشري إلزامي، لا تنفيذ تلقائي
            </div>
          )}

          {!session || !isRunningOrPaused ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">السيناريو (Scenario)</label>
                <select
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value as ScenarioId)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-semibold"
                >
                  {SCENARIOS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-1.5">{SCENARIOS.find((s) => s.id === scenario)?.description}</p>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">الرحلة (اختياري — تُختار تلقائياً إن لم تُحدد)</label>
                <select
                  value={selectedTripId}
                  onChange={(e) => setSelectedTripId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-semibold"
                >
                  <option value="">تلقائي — أي رحلة نشطة</option>
                  {trips.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.id.slice(0, 8)}… · حافلة {t.busId.slice(0, 8)}… ({t.status})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                جاهز (READY)
              </div>

              <button
                disabled={busy}
                onClick={handleStart}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                بدء المحاكاة (START SIMULATION)
              </button>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="text-xs font-bold text-slate-500">السيناريو</div>
                  <div className="font-black text-slate-900">{SCENARIOS.find((s) => s.id === session.scenario)?.label}</div>
                </div>
                <div className="flex items-center gap-1.5 bg-indigo-50 text-indigo-800 border border-indigo-200 px-3 py-1 rounded-full text-xs font-bold">
                  <Loader2 className={`w-3.5 h-3.5 ${session.status === 'RUNNING' ? 'animate-spin' : ''}`} />
                  {STATUS_LABELS[session.status] ?? session.status}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="bg-slate-50 rounded-xl p-3">
                  <div className="text-[10px] font-bold text-slate-500">الخطوة</div>
                  <div className="font-black text-slate-900">
                    {session.currentStep} / {session.totalSteps}
                  </div>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <div className="text-[10px] font-bold text-slate-500">الوقت المحاكى</div>
                  <div className="font-black text-slate-900 flex items-center justify-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {new Date(session.simulatedTime).toLocaleTimeString('ar-OM', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 col-span-2 sm:col-span-2">
                  <div className="text-[10px] font-bold text-slate-500">الحدث الحالي</div>
                  <div className="font-black text-slate-900 text-xs">{session.lastResult ? labelFor(session.lastResult.eventType) : '—'}</div>
                </div>
              </div>

              {waitingForApproval && (
                <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 font-bold text-sm">
                    <Clock className="w-4 h-4" />
                    بانتظار قرار المشرف — التوصية معروضة الآن في مركز الموافقات
                  </div>
                  <button
                    onClick={onOpenApprovalCenter}
                    className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg"
                  >
                    فتح مركز الموافقات
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  disabled={busy || !canAdvance}
                  onClick={handleAdvance}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-bold py-2.5 rounded-xl"
                >
                  <Play className="w-4 h-4" />
                  {waitingForApproval ? 'تحقق من القرار' : 'متابعة الخطوة التالية'}
                </button>
                <button
                  disabled={busy || session.status === 'COMPLETED'}
                  onClick={handlePauseResume}
                  className="flex items-center justify-center gap-1.5 bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-40 text-slate-700 text-sm font-bold py-2.5 px-4 rounded-xl"
                >
                  {session.status === 'RUNNING' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  {session.status === 'RUNNING' ? 'إيقاف مؤقت' : 'استئناف'}
                </button>
                <button
                  disabled={busy}
                  onClick={handleCancel}
                  className="flex items-center justify-center gap-1.5 bg-white border border-rose-300 hover:bg-rose-50 text-rose-700 text-sm font-bold py-2.5 px-4 rounded-xl"
                >
                  <Square className="w-4 h-4" />
                  إلغاء
                </button>
              </div>
            </div>
          )}

          {session && (session.status === 'COMPLETED' || session.status === 'FAILED' || session.status === 'CANCELLED') && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <h3 className="font-black text-slate-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                نتيجة المحاكاة (SIMULATION {session.status})
              </h3>
              {recommendation ? (
                <div className="space-y-1.5 text-sm">
                  <Row label="التوصية" value={recommendation.title} />
                  <Row label="مستوى الخطورة" value={recommendation.severity} />
                  <Row label="الثقة" value={`${Math.round(recommendation.confidence * 100)}%`} />
                  <Row label="القرار" value={recommendation.status} />
                  {verification && (
                    <>
                      <Row label="التنفيذ" value={verification.status === 'failed' ? 'فشل' : 'نجاح'} />
                      <Row
                        label="التحقق"
                        value={
                          verification.improvementMins != null
                            ? `تحسّن ${verification.improvementMins} دقيقة`
                            : verification.status
                        }
                      />
                    </>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-500">لم يلزم أي إجراء تشغيلي لهذا السيناريو.</p>
              )}
            </div>
          )}

          {/* Timeline */}
          {events.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <h3 className="font-black text-slate-900 mb-3">الخط الزمني (Timeline)</h3>
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {[...events].reverse().map((ev) => (
                  <div key={ev.id} className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs ${colorFor(ev.eventType)}`}>
                    {iconFor(ev.eventType)}
                    <span className="font-bold flex-1">{labelFor(ev.eventType)}</span>
                    <span className="font-mono opacity-70">
                      {new Date(ev.createdAt).toLocaleTimeString('ar-OM', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            disabled={busy}
            onClick={handleReset}
            className="w-full flex items-center justify-center gap-1.5 text-slate-500 hover:text-slate-700 text-xs font-bold py-2"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            إعادة ضبط جميع جلسات المحاكاة (لا يمس السجل الفعلي)
          </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500 font-semibold">{label}</span>
      <span className="text-slate-900 font-bold">{value}</span>
    </div>
  );
}
