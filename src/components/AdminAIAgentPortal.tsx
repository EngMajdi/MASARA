import React, { useEffect, useMemo, useState } from 'react';
import { Route, AIAgentWorkflowStep, Bus as BusType, Student, School, CurrentLocation } from '../types';
import { AuthUser } from './AuthModal';
import { legacyAuthHeaders } from '../services/legacyAuthHeaders';
import { getFleetCurrentLocations } from '../services/currentLocationApi';
import { listRecommendations } from '../services/approvalsApi';
import { useGovernedBusNumbers } from '../services/governedBusResolver';
import { LiveRadar } from './live/LiveRadar';
import { Card, Metric, Badge, Tabs, MobileTabBar, Button, EmptyState, ConfirmDialog } from './ui';
import type { TabItem } from './ui';

/**
 * Real pending-approval count. Phase 9C fix — a real fabricated-KPI bug found
 * live during the UX audit: this tile used to render a literal "—" string,
 * never a real number, on the very first thing an admin sees. Now reads the
 * same `listRecommendations` source the Approval Center itself uses.
 */
function usePendingApprovalsCount(userEmail: string | undefined) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!userEmail) return;
    let cancelled = false;
    const load = () =>
      listRecommendations(userEmail, 'pending')
        .then((list) => !cancelled && setCount(list.length))
        .catch(() => !cancelled && setCount(null));
    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [userEmail]);
  return count;
}

/** Real fleet current-location projection, polled (docs/LIVE_TRACKING_ARCHITECTURE_AUDIT.md). */
function useFleetLocations(userEmail: string | undefined) {
  const [locations, setLocations] = useState<CurrentLocation[]>([]);
  useEffect(() => {
    if (!userEmail) return;
    let cancelled = false;
    const load = () => getFleetCurrentLocations(userEmail).then((data) => !cancelled && setLocations(data)).catch(() => !cancelled && setLocations([]));
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [userEmail]);
  return locations;
}
import {
  Sparkles,
  Bot,
  Loader2,
  CheckCircle2,
  Users,
  Bus,
  Compass,
  Fuel,
  Activity,
  AlertTriangle,
  Gauge,
  Navigation as NavigationIcon,
  Siren,
  Car,
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  UserCog,
  Database,
  ShieldAlert,
  Radio,
  Zap,
  TrendingUp,
  Clock,
  RotateCcw,
  Send
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid
} from 'recharts';

interface AdminAIAgentPortalProps {
  workflowSteps: AIAgentWorkflowStep[];
  routes: Route[];
  buses: BusType[];
  students: Student[];
  schools: School[];
  onOptimizeRoutes: (trafficCondition: string) => Promise<any>;
  onTriggerReroute: (busId: string, incident: string) => Promise<any>;
  currentUser: AuthUser | null;
  onOpenDataManagement: () => void;
  onOpenEmployeeManagement: () => void;
  onOpenApprovalCenter: () => void;
  onOpenSimulationCenter: () => void;
  onOpenOperationsFeed: () => void;
}

const SECTIONS: TabItem[] = [
  { id: 'operations', label: 'العمليات', icon: <LayoutGrid className="w-4 h-4" /> },
  { id: 'people', label: 'الأشخاص', icon: <UserCog className="w-4 h-4" /> },
  { id: 'transport', label: 'النقل', icon: <Bus className="w-4 h-4" /> },
  { id: 'ai', label: 'الذكاء الاصطناعي', icon: <Bot className="w-4 h-4" /> }
];

/**
 * Phase 9B — an admin thinks "operations → people → transport → system →
 * AI", not "AI architecture first". Operations (real fleet/student status)
 * is now the default landing section; AI is a clearly secondary tool
 * reached deliberately, and its default state is an honest, empty
 * "run this to get a recommendation" prompt — never pre-filled fake
 * analysis (the previous version's biggest single trust problem).
 */
export const AdminAIAgentPortal: React.FC<AdminAIAgentPortalProps> = ({
  workflowSteps,
  routes,
  buses,
  students,
  schools,
  onOptimizeRoutes,
  onTriggerReroute,
  currentUser,
  onOpenDataManagement,
  onOpenEmployeeManagement,
  onOpenApprovalCenter,
  onOpenSimulationCenter,
  onOpenOperationsFeed
}) => {
  const [section, setSection] = useState<'operations' | 'people' | 'transport' | 'ai'>('operations');
  const fleetLocations = useFleetLocations(currentUser?.email);
  // Governed bus UUIDs never match legacy `Bus.id` — only `busNumber` does
  // (see governedBusResolver.ts / docs/LIVE_TRACKING_ARCHITECTURE_AUDIT.md).
  const governedFleetBusIds = useMemo(() => fleetLocations.map((l) => l.busId), [fleetLocations]);
  const governedBusNumbers = useGovernedBusNumbers(governedFleetBusIds, currentUser?.email);
  const pendingApprovals = usePendingApprovalsCount(currentUser?.email);

  // AI section state
  const [trafficInput] = useState('ازدحام مروري مرتفع عند مخرج حي القرم وشارع السلطان قابوس');
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [aiReport, setAiReport] = useState<any>(null);
  const [showWhy, setShowWhy] = useState(false);
  const [showReviewConfirm, setShowReviewConfirm] = useState(false);

  const [incidentInput, setIncidentInput] = useState('حادث بسيط مروري على طريق مسقط السريع أدى لتأخير الحافلة 101');
  const [isSimulatingReroute, setIsSimulatingReroute] = useState(false);
  const [rerouteResult, setRerouteResult] = useState<any>(null);

  const [activeAgentTab, setActiveAgentTab] = useState<'safety' | 'maintenance' | 'planning'>('safety');
  const [isRunningAgent, setIsRunningAgent] = useState(false);
  const [agentResult, setAgentResult] = useState<any>(null);

  const [selectedTrafficLevel, setSelectedTrafficLevel] = useState<'smooth' | 'moderate' | 'heavy' | 'accident'>('heavy');
  const [isPredictingEta, setIsPredictingEta] = useState(false);
  const [etaPredictions, setEtaPredictions] = useState<any>(null);
  const [showArchitecture, setShowArchitecture] = useState(false);

  const handlePredictTrafficEta = async (level: typeof selectedTrafficLevel = selectedTrafficLevel) => {
    setSelectedTrafficLevel(level);
    setIsPredictingEta(true);
    try {
      const res = await fetch('/api/ai/predict-traffic-eta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(currentUser?.sessionToken) },
        body: JSON.stringify({ trafficLevel: level })
      });
      const data = await res.json();
      if (data?.predictionResult) setEtaPredictions(data.predictionResult);
    } catch (e) {
      console.error(e);
    } finally {
      setIsPredictingEta(false);
    }
  };

  const handleRunSpecializedAgent = async (agentType: typeof activeAgentTab) => {
    setActiveAgentTab(agentType);
    setIsRunningAgent(true);
    try {
      const res = await fetch('/api/ai/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(currentUser?.sessionToken) },
        body: JSON.stringify({ agentType })
      });
      const data = await res.json();
      if (data?.agentResult) setAgentResult(data.agentResult);
    } catch (e) {
      console.error(e);
    } finally {
      setIsRunningAgent(false);
    }
  };

  const handleRunAiOptimization = async () => {
    setIsOptimizing(true);
    try {
      const res = await onOptimizeRoutes(trafficInput);
      // Phase 9C fix — see server.ts's optimize-routes comment: `isFallback` distinguishes a
      // genuine fresh AI analysis from the static template served when the AI service is
      // unreachable, so this can never be presented as if it were computed for this request.
      if (res?.result) setAiReport({ ...res.result, isFallback: !!res.isFallback });
    } catch (e) {
      console.error(e);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleRunRerouteSimulation = async () => {
    setIsSimulatingReroute(true);
    try {
      const res = await onTriggerReroute('bus-101', incidentInput);
      if (res?.rerouteData) setRerouteResult({ ...res.rerouteData, isFallback: !!res.isFallback });
    } catch (e) {
      console.error(e);
    } finally {
      setIsSimulatingReroute(false);
    }
  };

  const fleetSummary = useMemo(() => {
    const activeBuses = buses.filter((b) => b.status === 'en_route_pickup' || b.status === 'en_route_school').length;
    const travelingStudents = students.filter((s) => s.status === 'boarded' || s.status === 'at_school').length;
    const attention = buses.filter((b) => b.fuelLevel < 20 || b.safetyScore < 70).length;
    return { activeBuses, totalBuses: buses.length, travelingStudents, totalStudents: students.length, attention };
  }, [buses, students]);

  const attentionBuses = buses.filter((b) => b.fuelLevel < 20 || b.safetyScore < 70);
  const fleetFuelData = buses.map((b) => ({ bus: b.busNumber, fuelLevel: b.fuelLevel, safetyScore: b.safetyScore }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-text-primary">عمليات مَسارَا</h1>
        <p className="text-sm text-text-secondary mt-0.5">{schools[0]?.nameAr ?? 'نظرة عامة على النظام'}</p>
      </div>

      <div className="hidden sm:flex">
        <Tabs items={SECTIONS} activeId={section} onChange={(id) => setSection(id as typeof section)} />
      </div>

      {section === 'operations' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <Metric icon={<Bus />} tone="success" value={fleetSummary.activeBuses} total={fleetSummary.totalBuses} label="حافلات نشطة" />
            <Metric icon={<Users />} tone="info" value={fleetSummary.travelingStudents} total={fleetSummary.totalStudents} label="طلاب في الطريق" />
            <Metric icon={<AlertTriangle />} tone={fleetSummary.attention > 0 ? 'danger' : 'neutral'} value={fleetSummary.attention} label="يحتاج انتباه" emphasize={fleetSummary.attention > 0} />
            <Metric
              icon={<ShieldAlert />}
              tone={pendingApprovals !== null && pendingApprovals > 0 ? 'warning' : 'neutral'}
              value={pendingApprovals ?? '—'}
              label="طلبات موافقة"
              emphasize={pendingApprovals !== null && pendingApprovals > 0}
              onClick={onOpenApprovalCenter}
            />
          </div>

          {attentionBuses.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-text-primary mb-2">يحتاج انتباه</h2>
              <div className="space-y-2">
                {attentionBuses.map((bus) => (
                  <Card key={bus.id} padding="sm" className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-danger-soft text-danger flex items-center justify-center shrink-0">
                      <Fuel className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm text-text-primary">{bus.busNumber}</div>
                      <div className="text-xs text-text-secondary">{bus.fuelLevel < 20 ? `وقود منخفض (${bus.fuelLevel}%)` : `مؤشر سلامة منخفض (${bus.safetyScore}%)`}</div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          <LiveRadar
            mode="fleet"
            title="رادار الأسطول المباشر (GPS Live Radar)"
            entries={fleetLocations.map((loc) => ({
              busId: loc.busId,
              busLabel: governedBusNumbers[loc.busId] ?? loc.busId.slice(0, 8),
              lat: loc.latitude,
              lng: loc.longitude,
              freshness: loc.freshness
            }))}
            destination={schools[0] ? { lat: schools[0].location.lat, lng: schools[0].location.lng, name: schools[0].nameAr } : undefined}
          />

          <Card>
            <h3 className="font-bold text-sm text-text-primary mb-3 flex items-center gap-2"><Activity className="w-4 h-4 text-primary" />الوقود والسلامة لكل حافلة</h3>
            {fleetFuelData.length === 0 ? (
              <EmptyState icon={<Bus />} title="لا توجد بيانات أسطول بعد" />
            ) : (
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={fleetFuelData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="bus" stroke="#64748b" fontSize={11} tickLine={false} />
                    <YAxis stroke="#64748b" fontSize={11} tickLine={false} unit="%" />
                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', color: '#fff', fontSize: '12px' }} />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                    <Bar dataKey="fuelLevel" name="الوقود (%)" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="safetyScore" name="السلامة (%)" fill="#10b981" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <Button variant="secondary" icon={<ShieldAlert className="w-4 h-4 text-danger" />} onClick={onOpenApprovalCenter}>مركز الموافقات</Button>
            <Button variant="secondary" icon={<Gauge className="w-4 h-4 text-primary" />} onClick={onOpenSimulationCenter}>محاكاة مَسارَا</Button>
            <Button variant="secondary" icon={<Radio className="w-4 h-4 text-text-secondary" />} onClick={onOpenOperationsFeed}>سجل عمليات الذكاء الاصطناعي</Button>
          </div>
        </div>
      )}

      {section === 'people' && (
        <div className="space-y-3">
          <Card interactive onClick={onOpenEmployeeManagement} className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0"><UserCog className="w-5 h-5" /></div>
            <div className="flex-1">
              <h3 className="font-bold text-sm text-text-primary">إدارة الموظفين</h3>
              <p className="text-xs text-text-secondary">إنشاء وتفعيل وتعطيل حسابات السائقين وموظفي المدرسة</p>
            </div>
          </Card>
        </div>
      )}

      {section === 'transport' && (
        <div className="space-y-4">
          <Card interactive onClick={onOpenDataManagement} className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0"><Database className="w-5 h-5" /></div>
            <div className="flex-1">
              <h3 className="font-bold text-sm text-text-primary">إدارة البيانات</h3>
              <p className="text-xs text-text-secondary">الطلاب، الحافلات، والمسارات المدرسية</p>
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-2.5">
            <Metric icon={<Bus />} value={buses.length} label="الحافلات" />
            <Metric icon={<Compass />} value={routes.length} label="المسارات" />
          </div>
        </div>
      )}

      {section === 'ai' && (
        <div className="space-y-5">
          {/* AI Recommendation card — the ONE pattern for AI output: a plain
              claim, an expandable "why", and an explicit human review step.
              Never the raw pipeline stages by default. */}
          <Card className="space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0"><Sparkles className="w-5 h-5" /></div>
              <div>
                <h3 className="font-bold text-sm text-text-primary">توصية الذكاء الاصطناعي</h3>
                <p className="text-xs text-text-secondary">تحليل مسارات الأسطول الحالية</p>
              </div>
            </div>

            {!aiReport ? (
              <div className="text-center py-6">
                <p className="text-sm text-text-secondary mb-3">لم يُطلب تحليل بعد.</p>
                <Button variant="primary" onClick={handleRunAiOptimization} loading={isOptimizing} icon={<Sparkles className="w-4 h-4" />}>
                  تشغيل تحليل المسارات
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {aiReport.isFallback && (
                  <div className="bg-warning-soft border border-warning-border rounded-xl p-2.5 text-xs text-amber-900">
                    تعذّر الوصول إلى خدمة الذكاء الاصطناعي المباشرة — هذا تقدير عام غير محسوب لبيانات هذه المدرسة تحديداً.
                  </div>
                )}
                <p className="text-sm text-text-primary leading-relaxed">{aiReport.summaryAr}</p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-success-soft rounded-xl p-2.5 text-center">
                    <div className="text-lg font-black text-emerald-700">+{aiReport.efficiencyGain}%</div>
                    <div className="text-xs text-emerald-700">كفاءة</div>
                  </div>
                  <div className="bg-warning-soft rounded-xl p-2.5 text-center">
                    <div className="text-lg font-black text-amber-700">{aiReport.timeSavedMins}</div>
                    <div className="text-xs text-amber-700">دقيقة موفرة</div>
                  </div>
                  <div className="bg-info-soft rounded-xl p-2.5 text-center">
                    <div className="text-lg font-black text-sky-700">{aiReport.fuelSavedLiters}</div>
                    <div className="text-xs text-sky-700">لتر موفر</div>
                  </div>
                </div>

                <button onClick={() => setShowWhy((v) => !v)} className="text-xs font-bold text-primary flex items-center gap-1">
                  لماذا؟ {showWhy ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
                {showWhy && aiReport.recommendations && (
                  <div className="space-y-1.5 animate-fade-in">
                    {aiReport.recommendations.map((rec: string, idx: number) => (
                      <div key={idx} className="bg-surface-sunken border border-border-default p-2.5 rounded-lg text-xs text-text-secondary flex items-start gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                        <span>{rec}</span>
                      </div>
                    ))}
                  </div>
                )}

                <Button variant="primary" fullWidth onClick={() => setShowReviewConfirm(true)}>مراجعة واعتماد</Button>
              </div>
            )}
          </Card>

          {/* Traffic ETA predictor */}
          <Card className="space-y-3">
            <h3 className="font-bold text-sm text-text-primary flex items-center gap-2"><Gauge className="w-4 h-4 text-amber-600" />توقعات الوصول حسب الازدحام</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: 'smooth' as const, label: 'سلس', icon: null },
                { id: 'moderate' as const, label: 'متوسط', icon: null },
                { id: 'heavy' as const, label: 'كثيف', icon: null },
                { id: 'accident' as const, label: 'طارئ', icon: Siren }
              ].map((opt) => {
                const Icon = opt.icon;
                const isSel = selectedTrafficLevel === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => handlePredictTrafficEta(opt.id)}
                    disabled={isPredictingEta}
                    className={`py-2.5 rounded-xl border text-sm font-bold flex items-center justify-center gap-1.5 ${isSel ? 'bg-primary text-white border-primary-hover' : 'bg-surface-sunken text-text-secondary border-border-default'}`}
                  >
                    {isPredictingEta && isSel ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : Icon && <Icon className="w-3.5 h-3.5" />}
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {etaPredictions ? (
              <div className="space-y-2">
                {etaPredictions.predictions?.map((pred: any, idx: number) => (
                  <div key={pred.busId || idx} className="flex items-center justify-between bg-surface-sunken border border-border-default rounded-lg p-2.5 text-sm">
                    <span className="font-bold text-text-primary">{pred.busNumber}</span>
                    <span className="text-text-secondary">{pred.originalEtaMins} ← <strong className="text-amber-600">{pred.predictedEtaMins} د</strong></span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-tertiary text-center py-2">اختر حالة الازدحام لعرض التوقعات</p>
            )}
          </Card>

          {/* Specialized agents */}
          <Card className="space-y-3">
            <h3 className="font-bold text-sm text-text-primary flex items-center gap-2"><Bot className="w-4 h-4 text-primary" />الوكلاء المتخصصون</h3>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'safety' as const, label: 'السلامة', icon: CheckCircle2 },
                { id: 'maintenance' as const, label: 'الصيانة', icon: Bus },
                { id: 'planning' as const, label: 'التخطيط', icon: Compass }
              ].map((agent) => {
                const Icon = agent.icon;
                return (
                  <button
                    key={agent.id}
                    onClick={() => handleRunSpecializedAgent(agent.id)}
                    disabled={isRunningAgent}
                    className={`py-3 rounded-xl border flex flex-col items-center gap-1.5 text-xs font-bold ${activeAgentTab === agent.id && agentResult ? 'bg-primary-soft border-primary-border text-primary' : 'bg-surface-sunken border-border-default text-text-secondary'}`}
                  >
                    <Icon className="w-4 h-4" />
                    {agent.label}
                  </button>
                );
              })}
            </div>
            {isRunningAgent && <div className="text-center py-3 text-sm text-text-secondary flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />جاري التشغيل…</div>}
            {agentResult && !isRunningAgent && (
              <div className="bg-surface-sunken border border-border-default rounded-xl p-3 space-y-2 text-sm animate-fade-in">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-text-primary">{agentResult.agentTitle}</span>
                  <Badge tone="success">{agentResult.agentStatus}</Badge>
                </div>
                {agentResult.findings?.map((item: string, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-text-secondary">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    {item}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Reroute simulator */}
          <Card className="space-y-3">
            <h3 className="font-bold text-sm text-text-primary flex items-center gap-2"><RotateCcw className="w-4 h-4 text-amber-600" />محاكي إعادة التوجيه</h3>
            <input
              value={incidentInput}
              onChange={(e) => setIncidentInput(e.target.value)}
              className="w-full h-11 bg-surface-sunken border border-border-default rounded-xl px-3 text-sm focus:outline-none focus:border-primary"
            />
            <Button variant="secondary" fullWidth loading={isSimulatingReroute} icon={<Zap className="w-4 h-4" />} onClick={handleRunRerouteSimulation}>
              محاكاة تحويل حافلة 101
            </Button>
            {rerouteResult && (
              <div className="bg-warning-soft border border-warning-border rounded-xl p-3 text-sm text-amber-900 space-y-1">
                <div className="font-bold">{rerouteResult.rerouteTitleAr}</div>
                <p className="text-amber-800">{rerouteResult.actionPlanAr}</p>
                {rerouteResult.isFallback && (
                  <p className="text-xs text-amber-700 pt-1 border-t border-warning-border">تعذّر الوصول إلى خدمة الذكاء الاصطناعي المباشرة — هذه خطة استرشادية عامة، وليست تحليلاً حياً لهذا الحادث.</p>
                )}
              </div>
            )}
          </Card>

          {/* Collapsed architecture explainer */}
          <div>
            <button onClick={() => setShowArchitecture((v) => !v)} className="w-full flex items-center justify-between text-sm font-bold text-text-secondary py-2">
              <span>كيف يعمل نظام الذكاء الاصطناعي</span>
              {showArchitecture ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showArchitecture && (
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5 animate-fade-in">
                {workflowSteps.map((step) => (
                  <div key={step.stepNumber} className="bg-surface-sunken border border-border-default rounded-xl p-3 space-y-1.5">
                    <span className="w-6 h-6 rounded-lg bg-primary text-white font-bold flex items-center justify-center text-xs">{step.stepNumber}</span>
                    <h4 className="font-bold text-xs text-text-primary">{step.titleAr}</h4>
                    <p className="text-xs text-text-secondary leading-relaxed">{step.descriptionAr}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <MobileTabBar items={SECTIONS} activeId={section} onChange={(id) => setSection(id as typeof section)} />

      <ConfirmDialog
        isOpen={showReviewConfirm}
        tone="info"
        title="اعتماد توصية المسارات"
        description="ستُنقل هذه التوصية إلى مركز الموافقات لمراجعتها قبل أي تطبيق فعلي — لا يوجد تطبيق تلقائي على المسارات."
        confirmLabel="فتح مركز الموافقات"
        onConfirm={() => {
          setShowReviewConfirm(false);
          onOpenApprovalCenter();
        }}
        onCancel={() => setShowReviewConfirm(false)}
      />
    </div>
  );
};
