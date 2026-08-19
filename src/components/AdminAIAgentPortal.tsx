import React, { useState } from 'react';
import { Route, AIAgentWorkflowStep } from '../types';
import { AuthUser } from './AuthModal';
import { legacyAuthHeaders } from '../services/legacyAuthHeaders';
import {
  Sparkles,
  Zap,
  TrendingUp,
  RotateCcw,
  Bot,
  Layers,
  Send,
  Loader2,
  CheckCircle2,
  ArrowLeft,
  Flame,
  ShieldCheck,
  Building,
  Users,
  Compass,
  Bus,
  MapPin,
  Clock,
  Radio,
  FileSpreadsheet,
  BarChart3,
  PieChart as PieIcon,
  Fuel,
  Activity,
  Award,
  AlertTriangle,
  Gauge,
  Navigation,
  Siren,
  Car,
  ShieldAlert
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  ComposedChart,
  Line,
  AreaChart,
  Area
} from 'recharts';

interface AdminAIAgentPortalProps {
  workflowSteps: AIAgentWorkflowStep[];
  routes: Route[];
  onOptimizeRoutes: (trafficCondition: string) => Promise<any>;
  onTriggerReroute: (busId: string, incident: string) => Promise<any>;
  onAskAdvisor: (query: string) => Promise<string>;
  currentUser: AuthUser | null;
}

export const AdminAIAgentPortal: React.FC<AdminAIAgentPortalProps> = ({
  workflowSteps,
  routes,
  onOptimizeRoutes,
  onTriggerReroute,
  onAskAdvisor,
  currentUser
}) => {
  const [trafficInput, setTrafficInput] = useState('ازدحام مروري مرتفع عند مخرج حي القرم وشارع السلطان قابوس');
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [aiReport, setAiReport] = useState<any>(null);

  const [incidentInput, setIncidentInput] = useState('حادث بسيط مروري على طريق مسقط السريع أدى لتأخير الحافلة 101');
  const [isSimulatingReroute, setIsSimulatingReroute] = useState(false);
  const [rerouteResult, setRerouteResult] = useState<any>(null);

  const [advisorQuery, setAdvisorQuery] = useState('');
  const [isAskingAdvisor, setIsAskingAdvisor] = useState(false);
  const [advisorAnswer, setAdvisorAnswer] = useState<string | null>(null);

  // Specialized Agents Execution state
  const [activeAgentTab, setActiveAgentTab] = useState<'safety' | 'maintenance' | 'planning'>('safety');
  const [isRunningAgent, setIsRunningAgent] = useState(false);
  const [agentResult, setAgentResult] = useState<any>(null);

  // AI Traffic ETA Prediction state
  const [selectedTrafficLevel, setSelectedTrafficLevel] = useState<'smooth' | 'moderate' | 'heavy' | 'accident'>('heavy');
  const [isPredictingEta, setIsPredictingEta] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [etaPredictions, setEtaPredictions] = useState<any>({
    trafficConditionSummaryAr: 'تحليل مباشر لكثافة الحركة المرورية عبر خوارزميات Gemini 2.5 AI. تم رصد اختناق مروري على شارع السلطان قابوس والدائري، وتم تحديث ETA للحافلات بدقة.',
    overallTrafficIndex: 78,
    predictions: [
      {
        busId: 'bus-101',
        busNumber: 'حافلة 101',
        originalEtaMins: 12,
        predictedEtaMins: 22,
        delayMins: 10,
        congestionPercent: 82,
        aiAlternativeRoute: 'تحويل الحركة إلى طريق مسقط السريع يوفر 7 دقائق وتفادي دوار القرم',
        confidenceScore: 97,
        statusBadge: 'تأخير متوسط'
      },
      {
        busId: 'bus-102',
        busNumber: 'حافلة 102',
        originalEtaMins: 8,
        predictedEtaMins: 11,
        delayMins: 3,
        congestionPercent: 45,
        aiAlternativeRoute: 'المسار الحالي عبر حي الخوض مناسب مع توخي الحذر عند الإشارة',
        confidenceScore: 95,
        statusBadge: 'تأخير طفيف'
      },
      {
        busId: 'bus-103',
        busNumber: 'حافلة 103',
        originalEtaMins: 15,
        predictedEtaMins: 16,
        delayMins: 1,
        congestionPercent: 20,
        aiAlternativeRoute: 'مسار انسيابي كامل - الوصول في الوقت المرفق بدقة',
        confidenceScore: 99,
        statusBadge: 'مسار سلس'
      }
    ]
  });

  const handlePredictTrafficEta = async (level: 'smooth' | 'moderate' | 'heavy' | 'accident' = selectedTrafficLevel) => {
    setSelectedTrafficLevel(level);
    setIsPredictingEta(true);
    try {
      const res = await fetch('/api/ai/predict-traffic-eta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(currentUser?.sessionToken) },
        body: JSON.stringify({ trafficLevel: level })
      });
      const data = await res.json();
      if (data && data.predictionResult) {
        setEtaPredictions(data.predictionResult);
        setToastMessage(`تم تحديث التوقعات الحية بالذكاء الاصطناعي بنجاح (مؤشر الازدحام ${data.predictionResult.overallTrafficIndex}%)`);
        setTimeout(() => setToastMessage(null), 4000);
      }
    } catch (e) {
      console.error('Error predicting traffic ETA:', e);
    } finally {
      setIsPredictingEta(false);
    }
  };

  const handleRunSpecializedAgent = async (agentType: 'safety' | 'maintenance' | 'planning') => {
    setActiveAgentTab(agentType);
    setIsRunningAgent(true);
    try {
      const res = await fetch('/api/ai/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(currentUser?.sessionToken) },
        body: JSON.stringify({ agentType })
      });
      const data = await res.json();
      if (data && data.agentResult) {
        setAgentResult(data.agentResult);
      }
    } catch (e) {
      console.error('Error running agent:', e);
    } finally {
      setIsRunningAgent(false);
    }
  };

  const handleRunAiOptimization = async () => {
    setIsOptimizing(true);
    try {
      const res = await onOptimizeRoutes(trafficInput);
      if (res && res.result) {
        setAiReport(res.result);
      }
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
      if (res && res.rerouteData) {
        setRerouteResult(res.rerouteData);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSimulatingReroute(false);
    }
  };

  const handleAskAdvisor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!advisorQuery.trim()) return;

    setIsAskingAdvisor(true);
    try {
      const ans = await onAskAdvisor(advisorQuery);
      setAdvisorAnswer(ans);
    } catch (e) {
      console.error(e);
    } finally {
      setIsAskingAdvisor(false);
    }
  };

  // Recharts Analytics Datasets
  const routeEfficiencyData = routes.map((r) => ({
    name: r.routeNameAr.replace('مسار ', '').split(' - ')[0] || r.routeNameAr,
    actualDistance: r.totalDistanceKm,
    optimizedDistance: Math.max(2, Number((r.totalDistanceKm * 0.81).toFixed(1))),
    efficiencyScore: r.aiEfficiencyScore || 92,
    durationMins: r.estimatedDurationMins
  }));

  const displayRouteData = routeEfficiencyData.length > 0 ? routeEfficiencyData : [
    { name: 'القرم', actualDistance: 14.2, optimizedDistance: 11.5, efficiencyScore: 94, durationMins: 22 },
    { name: 'الخوض', actualDistance: 18.5, optimizedDistance: 14.8, efficiencyScore: 89, durationMins: 28 },
    { name: 'الموالح', actualDistance: 12.0, optimizedDistance: 9.6, efficiencyScore: 96, durationMins: 18 },
    { name: 'العذيبة', actualDistance: 16.0, optimizedDistance: 13.2, efficiencyScore: 91, durationMins: 24 },
    { name: 'السيب', actualDistance: 21.0, optimizedDistance: 16.5, efficiencyScore: 88, durationMins: 32 },
  ];

  const attendanceData = [
    { name: 'حاضرون بالحافلة/المدرسة', value: 142, color: '#10b981' },
    { name: 'في المنزل (مؤكد)', value: 18, color: '#3b82f6' },
    { name: 'غائب بعذر مُسبق', value: 8, color: '#f59e0b' },
    { name: 'غائب بدون إشعار', value: 4, color: '#ef4444' }
  ];

  const fuelConsumptionData = [
    { bus: 'حافلة 101', fuelLevel: 85, fuelConsumed: 12.4, carbonSavedKg: 4.8 },
    { bus: 'حافلة 102', fuelLevel: 62, fuelConsumed: 15.2, carbonSavedKg: 3.9 },
    { bus: 'حافلة 103', fuelLevel: 91, fuelConsumed: 10.8, carbonSavedKg: 5.4 },
    { bus: 'حافلة 104', fuelLevel: 48, fuelConsumed: 18.0, carbonSavedKg: 3.2 },
    { bus: 'حافلة 105', fuelLevel: 78, fuelConsumed: 13.5, carbonSavedKg: 4.5 },
  ];

  return (
    <div className="space-y-8">
      {/* Top Banner - Architectural Blueprint */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 md:p-8 space-y-4 shadow-sm relative overflow-hidden text-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1 rounded-full text-xs font-bold mb-2">
              <Bot className="w-4 h-4 text-blue-600" />
              <span>فلو وكيل مَسارَا الذكي (MASARA AI AGENT ARCHITECTURE)</span>
            </div>
            <h2 className="text-2xl md:text-3xl font-black text-slate-900">
              معمارية وكيل الذكاء الاصطناعي للنقل المدرسي
            </h2>
            <p className="text-sm text-slate-600 max-w-2xl mt-1 leading-relaxed">
              منظومة إدارية متكاملة تقوم بجمع البيانات، تحليل المسافات والسعة الاستيعابية، واتخاذ قرارات التوجيه الأمثل للحافلات لحظة بلحظة مع إعادة التخطيط عند الطوارئ.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleRunAiOptimization}
              disabled={isOptimizing}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-3.5 rounded-2xl shadow-sm text-sm transition-all border border-blue-700 disabled:opacity-50"
            >
              {isOptimizing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>جاري تشغيل خوارزمية مَسارَا (Gemini)...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5 text-amber-300 animate-pulse" />
                  <span>تشغيل تحسين المسارات التلقائي بالذكاء الاصطناعي</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Architectural Diagram Visualizer matching the uploaded Image */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 md:p-8 space-y-6 shadow-sm text-slate-900">
        <div className="text-center space-y-1">
          <h3 className="text-xl font-bold text-slate-900 flex items-center justify-center gap-2">
            <Layers className="w-5 h-5 text-blue-600" />
            <span>المعمارية الخماسية لوكيل الذكاء الاصطناعي (MASARA AI WORKFLOW)</span>
          </h3>
          <p className="text-xs text-slate-500">تدفق البيانات من المدخلات حتى المخرجات المباشرة للمستخدمين</p>
        </div>

        {/* Inputs Bar */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
          <div className="text-xs font-bold text-amber-800 mb-3 flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-amber-600" />
            <span>المدخلات (Multi-Source Data Inputs)</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2 text-[11px] text-slate-800">
            <div className="bg-white p-2.5 rounded-xl border border-slate-200 text-center font-bold shadow-2xs">
              📍 مواقع الطلبة
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-slate-200 text-center font-bold shadow-2xs">
              🏫 مواقع المدارس
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-slate-200 text-center font-bold shadow-2xs">
              👥 عدد الطلبة
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-slate-200 text-center font-bold shadow-2xs">
              🚌 سعة الحافلات
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-slate-200 text-center font-bold shadow-2xs">
              ⏰ أوقات الدراسة
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-slate-200 text-center font-bold shadow-2xs">
              🪪 بيانات السائقين
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-slate-200 text-center font-bold shadow-2xs">
              🚦 حالة الطرق
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-slate-200 text-center font-bold shadow-2xs">
              🚏 نقاط التوقف
            </div>
          </div>
        </div>

        {/* 5-Step Agent Flow Core */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {workflowSteps.map((step) => (
            <div
              key={step.stepNumber}
              className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col justify-between space-y-3 relative shadow-2xs hover:border-blue-500 transition-all group"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="w-7 h-7 rounded-xl bg-blue-600 text-white font-bold flex items-center justify-center text-xs shadow-2xs">
                    {step.stepNumber}
                  </span>
                  <span className="text-[10px] text-emerald-800 font-mono bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-bold">
                    نشط ⚡
                  </span>
                </div>

                <h4 className="font-bold text-xs text-slate-900 group-hover:text-blue-600 transition-colors">
                  {step.titleAr}
                </h4>

                <p className="text-[11px] text-slate-600 leading-relaxed">
                  {step.descriptionAr}
                </p>
              </div>

              <div className="pt-2 border-t border-slate-200 space-y-1">
                {step.subTasks.map((task, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 text-[10px] text-slate-700 font-medium">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                    <span>{task}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Outputs Bar matching diagram */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
          <div className="text-xs font-bold text-blue-700 mb-3 flex items-center gap-1.5">
            <Send className="w-3.5 h-3.5 text-blue-600" />
            <span>المخرجات للمستخدمين (Dynamic User Portals)</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="bg-white border border-slate-200 p-3 rounded-xl flex items-center gap-3 shadow-2xs">
              <span className="text-2xl">📱</span>
              <div>
                <div className="font-bold text-slate-900">تطبيق ولي الأمر</div>
                <div className="text-[10px] text-slate-500">متابعة الرحلة لحظة بلحظة وتنبيهات الوصول</div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-3 rounded-xl flex items-center gap-3 shadow-2xs">
              <span className="text-2xl">🚌</span>
              <div>
                <div className="font-bold text-slate-900">تطبيق السائق</div>
                <div className="text-[10px] text-slate-500">المسار المقترح ونقاط التوقف وتأكيد الطلاب</div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-3 rounded-xl flex items-center gap-3 shadow-2xs">
              <span className="text-2xl">🏫</span>
              <div>
                <div className="font-bold text-slate-900">لوحة المدرسة</div>
                <div className="text-[10px] text-slate-500">وصول الطلبة وتقارير الحافلات والانضباط</div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-3 rounded-xl flex items-center gap-3 shadow-2xs">
              <span className="text-2xl">📊</span>
              <div>
                <div className="font-bold text-slate-900">لوحة الإدارة والحوكمة</div>
                <div className="text-[10px] text-slate-500">تقارير الأداء ومؤشرات الاستدامة المباشرة</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Recharts Analytics Section */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 md:p-8 space-y-6 shadow-sm text-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-50 text-blue-700 rounded-2xl border border-blue-100">
              <BarChart3 className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">
                لوحة التحليلات والإحصائيات البيانية المباشرة (Recharts Analytics Hub)
              </h3>
              <p className="text-xs text-slate-500">
                مؤشرات كفاءة المسارات المدرسية، ونسبة حضور وغياب الطلاب، واستهلاك الوقود لأسطول الحافلات
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 rounded-xl text-xs font-bold flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              مزامنة بيانية حية
            </span>
          </div>
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Chart 1: Route Efficiency Comparison */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4 lg:col-span-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-600" />
                <h4 className="font-bold text-sm text-slate-900">
                  مقارنة كفاءة المسارات المدرسية (قبل vs بعد تحسين الذكاء الاصطناعي)
                </h4>
              </div>
              <span className="text-[10px] font-bold text-blue-700 bg-blue-100/70 px-2 py-0.5 rounded">
                توفير %19 مسافة وقت
              </span>
            </div>

            <div className="h-64 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={displayRouteData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} unit=" كم" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', color: '#fff', fontSize: '12px' }}
                    itemStyle={{ color: '#38bdf8' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                  <Bar dataKey="actualDistance" name="المسافة قبل التحسين (كم)" fill="#94a3b8" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="optimizedDistance" name="المسافة بعد تحسين الذكاء الاصطناعي (كم)" fill="#2563eb" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 2: Attendance & Absence Breakdown */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PieIcon className="w-4 h-4 text-emerald-600" />
                <h4 className="font-bold text-sm text-slate-900">نسبة الطلاب الغائبين والحاضرين</h4>
              </div>
              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded">
                172 طالب
              </span>
            </div>

            <div className="h-52 w-full relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={attendanceData}
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={75}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {attendanceData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', color: '#fff', fontSize: '11px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
              {attendanceData.map((item, idx) => (
                <div key={idx} className="flex items-center gap-1.5 bg-white p-2 rounded-xl border border-slate-200">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }}></span>
                  <div className="truncate">
                    <div className="text-slate-500 text-[10px] truncate">{item.name}</div>
                    <div className="font-bold text-slate-900">{item.value} طالب</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Chart 3: Fuel Consumption & Carbon Saved per Bus */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4 lg:col-span-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Fuel className="w-4 h-4 text-amber-600" />
                <h4 className="font-bold text-sm text-slate-900">
                  مؤشر استهلاك الوقود والانبعاثات الكربونية للحافلات (Fuel Level & CO2 Reduction)
                </h4>
              </div>
              <span className="text-[10px] font-bold text-amber-800 bg-amber-100/70 px-2 py-0.5 rounded">
                متابعة الأسطول
              </span>
            </div>

            <div className="h-64 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={fuelConsumptionData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="bus" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis yAxisId="left" stroke="#64748b" fontSize={11} tickLine={false} unit=" لتر" />
                  <YAxis yAxisId="right" orientation="right" stroke="#10b981" fontSize={11} tickLine={false} unit=" كجم" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', color: '#fff', fontSize: '12px' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                  <Bar yAxisId="left" dataKey="fuelConsumed" name="الوقود المستهلك اليومي (لتر)" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                  <Bar yAxisId="left" dataKey="fuelLevel" name="مستوى الوقود المتبقي (%)" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="carbonSavedKg" name="الكربون الموفر (كجم CO2)" stroke="#10b981" strokeWidth={3} dot={{ r: 5, fill: '#10b981' }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>
      </div>

      {/* AI Traffic-Based Bus ETA Prediction Module (ميزة توقعات الوصول للحافلات بناءً على الازدحام) */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 md:p-8 space-y-6 shadow-sm text-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-50 text-amber-700 rounded-2xl border border-amber-200/80">
              <Gauge className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <span>توقعات الذكاء الاصطناعي لوقت الوصول (AI Traffic ETA Predictor)</span>
                <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
              </h3>
              <p className="text-xs text-slate-500">
                حساب وقت الوصول المتوقع (ETA) للحافلات المدرسية بدقة بناءً على حالة الازدحام المروري المباشر بمسقط
              </p>
            </div>
          </div>
          <span className="bg-amber-50 text-amber-800 border border-amber-200 px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5">
            <Navigation className="w-3.5 h-3.5 text-amber-600" />
            تحليل مروري فوري
          </span>
        </div>

        {/* Toast Alert */}
        {toastMessage && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold p-3.5 rounded-2xl flex items-center justify-between animate-fade-in">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{toastMessage}</span>
            </div>
            <button onClick={() => setToastMessage(null)} className="text-emerald-600 hover:text-emerald-900 font-bold">✕</button>
          </div>
        )}

        {/* Traffic Condition Selector & Actions */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Car className="w-4 h-4 text-slate-600" />
              <span>اختر حالة الازدحام المروري الحالية المسجلة بالرادار:</span>
            </label>
            <button
              onClick={() => handlePredictTrafficEta()}
              disabled={isPredictingEta}
              className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-2 shadow-sm transition-all disabled:opacity-50 shrink-0"
            >
              {isPredictingEta ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                  <span>جاري حساب التوقعات...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-slate-950" />
                  <span>تحديث التوقعات بالذكاء الاصطناعي</span>
                </>
              )}
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <button
              onClick={() => handlePredictTrafficEta('smooth')}
              disabled={isPredictingEta}
              className={`p-3 rounded-xl border text-right transition-all flex flex-col justify-between space-y-1.5 ${
                selectedTrafficLevel === 'smooth'
                  ? 'bg-emerald-500 text-white border-emerald-600 shadow'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-emerald-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold opacity-80">انسيابي</span>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
              </div>
              <div className="font-bold text-xs">مرور سلس وطبيعي</div>
              <div className="text-[10px] opacity-90">لا يوجد تأخير تذكر (1.0x)</div>
            </button>

            <button
              onClick={() => handlePredictTrafficEta('moderate')}
              disabled={isPredictingEta}
              className={`p-3 rounded-xl border text-right transition-all flex flex-col justify-between space-y-1.5 ${
                selectedTrafficLevel === 'moderate'
                  ? 'bg-blue-600 text-white border-blue-700 shadow'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold opacity-80">متوسط</span>
                <span className="w-2.5 h-2.5 rounded-full bg-blue-400"></span>
              </div>
              <div className="font-bold text-xs">بطء بالقرب من الدوارات</div>
              <div className="text-[10px] opacity-90">تأخير طفيف +3 إلى +5 دقائق</div>
            </button>

            <button
              onClick={() => handlePredictTrafficEta('heavy')}
              disabled={isPredictingEta}
              className={`p-3 rounded-xl border text-right transition-all flex flex-col justify-between space-y-1.5 ${
                selectedTrafficLevel === 'heavy'
                  ? 'bg-amber-500 text-slate-950 border-amber-600 shadow font-bold'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-amber-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold opacity-80">كثيف جداً</span>
                <span className="w-2.5 h-2.5 rounded-full bg-amber-600"></span>
              </div>
              <div className="font-bold text-xs">اختناق الشارع العام</div>
              <div className="text-[10px] opacity-90">تأخير متوسط +8 إلى +15 دقيقة</div>
            </button>

            <button
              onClick={() => handlePredictTrafficEta('accident')}
              disabled={isPredictingEta}
              className={`p-3 rounded-xl border text-right transition-all flex flex-col justify-between space-y-1.5 ${
                selectedTrafficLevel === 'accident'
                  ? 'bg-rose-600 text-white border-rose-700 shadow'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-rose-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold opacity-80">طوارئ / حادث</span>
                <Siren className="w-3.5 h-3.5 text-white animate-pulse" />
              </div>
              <div className="font-bold text-xs">حادث أو صيانة طريق</div>
              <div className="text-[10px] opacity-90">تأخير مرتفع / تحويل مسار</div>
            </button>
          </div>
        </div>

        {/* Gemini Traffic Predictive Analysis Header Banner */}
        {etaPredictions && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-white space-y-4">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="space-y-1 max-w-2xl">
                <div className="text-amber-400 font-bold text-xs flex items-center gap-1.5">
                  <Bot className="w-4 h-4 text-amber-400" />
                  <span>تحليل وكيل التنبؤ المروري (Gemini 2.5 Predictive AI):</span>
                </div>
                <p className="text-xs text-slate-200 leading-relaxed font-medium">
                  {etaPredictions.trafficConditionSummaryAr}
                </p>
              </div>

              <div className="bg-slate-800 border border-slate-700 p-3.5 rounded-xl shrink-0 text-center min-w-[140px]">
                <div className="text-[10px] text-slate-400">مؤشر الكثافة المرورية</div>
                <div className="text-2xl font-black text-amber-400 font-mono mt-0.5">
                  {etaPredictions.overallTrafficIndex}%
                </div>
                <div className="w-full bg-slate-700 h-1.5 rounded-full mt-1.5 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${etaPredictions.overallTrafficIndex}%` }}
                  ></div>
                </div>
              </div>
            </div>

            {/* Recharts ETA Comparison Bar Chart */}
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-300 font-bold">
                <span>مقارنة الوقت التقديري الأصلي (ETA) مقابل الوقت المتوقع المعدل بالذكاء الاصطناعي:</span>
                <span className="text-amber-400 text-[11px]">مقارنة دقيقة بالدقائق</span>
              </div>
              <div className="h-56 w-full pt-1">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={etaPredictions.predictions} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="busNumber" stroke="#94a3b8" fontSize={11} tickLine={false} />
                    <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} unit=" د" />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#020617', borderColor: '#334155', borderRadius: '12px', color: '#fff', fontSize: '12px' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
                    <Bar dataKey="originalEtaMins" name="الوقت الأولي (دقائق)" fill="#64748b" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="predictedEtaMins" name="الوقت المتوقع مع الازدحام (دقائق)" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* Bus Predictions Detailed Cards Grid */}
        <div className="space-y-3">
          <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
            <Bus className="w-4 h-4 text-blue-600" />
            <span>توقعات وصول الحافلات والتوصيات المباشرة لأولياء الأمور والمشرفين:</span>
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {etaPredictions?.predictions?.map((pred: any, idx: number) => {
              const busInfo = routes.find((r) => r.busId === pred.busId);
              return (
                <div
                  key={pred.busId || idx}
                  className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3 hover:border-amber-400 transition-all shadow-2xs"
                >
                  <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-blue-100 text-blue-800 rounded-xl font-bold text-xs">
                        {pred.busNumber || `حافلة ${idx + 101}`}
                      </div>
                      <div>
                        <div className="font-bold text-xs text-slate-900">
                          {busInfo?.routeNameAr || 'مسار حافلة مدرسة المسار'}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          سائق: سالم العبري
                        </div>
                      </div>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${
                        pred.delayMins > 8
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : pred.delayMins > 2
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      }`}
                    >
                      {pred.statusBadge || 'محدث'}
                    </span>
                  </div>

                  {/* ETA Comparison Stats */}
                  <div className="grid grid-cols-2 gap-2 text-center bg-white p-2.5 rounded-xl border border-slate-200">
                    <div className="border-l border-slate-100 pl-1">
                      <span className="text-[10px] text-slate-400 block">ETA الأولي</span>
                      <span className="text-sm font-bold text-slate-600 line-through">
                        {pred.originalEtaMins} دقيقة
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-amber-600 font-bold block">ETA المتوقع الجديد</span>
                      <span className="text-base font-black text-amber-600 font-mono">
                        {pred.predictedEtaMins} دقيقة
                      </span>
                      {pred.delayMins > 0 && (
                        <span className="text-[9px] text-rose-600 font-bold block">
                          (+{pred.delayMins} د تأخير)
                        </span>
                      )}
                    </div>
                  </div>

                  {/* AI Recommendation */}
                  <div className="text-xs bg-amber-50/70 border border-amber-200/80 p-2.5 rounded-xl space-y-1">
                    <div className="text-[10px] text-amber-900 font-bold flex items-center gap-1">
                      <Compass className="w-3 h-3 text-amber-700" />
                      <span>توصية المسار البديل من الذكاء الاصطناعي:</span>
                    </div>
                    <p className="text-[11px] text-slate-800 leading-relaxed font-medium">
                      {pred.aiAlternativeRoute}
                    </p>
                  </div>

                  {/* Confidence & Action Button */}
                  <div className="flex items-center justify-between pt-1 text-[10px]">
                    <span className="text-slate-500 font-medium">
                      ثقة النموذج: <strong className="text-emerald-700 font-bold">{pred.confidenceScore || 96}%</strong>
                    </span>
                    <button
                      onClick={() => {
                        setToastMessage(`تم إرسال إشعار فوري لأولياء أمور ${pred.busNumber} بتحديث ETA إلى ${pred.predictedEtaMins} دقيقة`);
                        setTimeout(() => setToastMessage(null), 4000);
                      }}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-2.5 py-1 rounded-lg transition-colors"
                    >
                      إرسال إشعار لأولياء الأمور
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Autonomous AI Agents Suite (مركز تشغيل الوكلاء المخصصين) */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 md:p-8 space-y-6 shadow-sm text-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-50 text-indigo-700 rounded-2xl border border-indigo-100">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">مركز وكلاء الذكاء الاصطناعي الأوتوماتيكية (AI Autonomous Agents Hub)</h3>
              <p className="text-xs text-slate-500">تشغيل وإدارة الوكلاء الأوتوماتيكيين للسلامة، الصيانة، وتخطيط الرحلات</p>
            </div>
          </div>
          <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 px-3 py-1 rounded-xl text-xs font-bold">
            GEMINI 2.5 FLASH POWERED ⚡
          </span>
        </div>

        {/* Agent Cards Selector */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={() => handleRunSpecializedAgent('safety')}
            disabled={isRunningAgent}
            className={`p-5 rounded-2xl border text-right transition-all flex flex-col justify-between space-y-3 ${
              activeAgentTab === 'safety'
                ? 'bg-emerald-50/70 border-emerald-400 shadow-sm'
                : 'bg-slate-50 border-slate-200 hover:border-emerald-300'
            }`}
          >
            <div className="flex justify-between items-center">
              <div className="p-2 bg-emerald-100 text-emerald-800 rounded-xl">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100/60 px-2.5 py-0.5 rounded-full">
                وكيل الأمان
              </span>
            </div>
            <div>
              <h4 className="font-bold text-sm text-slate-900">وكيل سلامة الطلاب والحضور</h4>
              <p className="text-xs text-slate-500 mt-1">مطابقة كشوفات الصعود، الإنذار المبكر للتأخير والغياب</p>
            </div>
            <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-xs text-emerald-700 font-bold">
              <span>تشغيل الفحص الفوري</span>
              <Sparkles className="w-4 h-4" />
            </div>
          </button>

          <button
            onClick={() => handleRunSpecializedAgent('maintenance')}
            disabled={isRunningAgent}
            className={`p-5 rounded-2xl border text-right transition-all flex flex-col justify-between space-y-3 ${
              activeAgentTab === 'maintenance'
                ? 'bg-amber-50/70 border-amber-400 shadow-sm'
                : 'bg-slate-50 border-slate-200 hover:border-amber-300'
            }`}
          >
            <div className="flex justify-between items-center">
              <div className="p-2 bg-amber-100 text-amber-800 rounded-xl">
                <Bus className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-bold text-amber-700 bg-amber-100/60 px-2.5 py-0.5 rounded-full">
                وكيل الصيانة
              </span>
            </div>
            <div>
              <h4 className="font-bold text-sm text-slate-900">وكيل الصيانة الاستباقية للأسطول</h4>
              <p className="text-xs text-slate-500 mt-1">تحليل الأعطال المتوقعة، استهلاك الوقود وضغط الإطارات</p>
            </div>
            <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-xs text-amber-700 font-bold">
              <span>فحص جاهزية الحافلات</span>
              <Sparkles className="w-4 h-4" />
            </div>
          </button>

          <button
            onClick={() => handleRunSpecializedAgent('planning')}
            disabled={isRunningAgent}
            className={`p-5 rounded-2xl border text-right transition-all flex flex-col justify-between space-y-3 ${
              activeAgentTab === 'planning'
                ? 'bg-blue-50/70 border-blue-400 shadow-sm'
                : 'bg-slate-50 border-slate-200 hover:border-blue-300'
            }`}
          >
            <div className="flex justify-between items-center">
              <div className="p-2 bg-blue-100 text-blue-800 rounded-xl">
                <Compass className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-bold text-blue-700 bg-blue-100/60 px-2.5 py-0.5 rounded-full">
                وكيل المسارات
              </span>
            </div>
            <div>
              <h4 className="font-bold text-sm text-slate-900">وكيل التخطيط والتطوير التشغيلي</h4>
              <p className="text-xs text-slate-500 mt-1">إعادة توزيع الحافلات والربط مع المدارس المجاورة</p>
            </div>
            <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-xs text-blue-700 font-bold">
              <span>تحليل الجدوى والمسارات</span>
              <Sparkles className="w-4 h-4" />
            </div>
          </button>
        </div>

        {/* Loading Indicator */}
        {isRunningAgent && (
          <div className="bg-slate-50 border border-slate-200 p-8 rounded-2xl text-center space-y-3 animate-pulse">
            <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
            <div className="font-bold text-sm text-slate-800">جاري الاتصال بالوكيل الذكي عبر خوارزمية Gemini 2.5...</div>
            <p className="text-xs text-slate-500">يقوم الوكيل بمعالجة البيانات المباشرة وتطبيق شروط الحوكمة والسلامة</p>
          </div>
        )}

        {/* Agent Run Results View */}
        {agentResult && !isRunningAgent && (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 space-y-5 animate-fade-in text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-indigo-600" />
                <span className="font-bold text-sm text-slate-900">{agentResult.agentTitle}</span>
              </div>
              <span className="bg-emerald-100 text-emerald-800 font-bold px-3 py-1 rounded-full text-[11px]">
                {agentResult.agentStatus}
              </span>
            </div>

            {agentResult.checkedStudentsCount && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-white p-3.5 rounded-xl border border-slate-200">
                  <div className="text-slate-500">إجمالي الطلاب المفحوصين:</div>
                  <div className="text-lg font-bold text-slate-900 mt-0.5">{agentResult.checkedStudentsCount} طالب</div>
                </div>

                {agentResult.riskScore && (
                  <div className="bg-white p-3.5 rounded-xl border border-slate-200">
                    <div className="text-slate-500">مؤشر سلامة وصعود الطلاب:</div>
                    <div className="text-lg font-bold text-emerald-700 mt-0.5">{agentResult.riskScore}/100 🛡️</div>
                  </div>
                )}

                {agentResult.fleetHealthScore && (
                  <div className="bg-white p-3.5 rounded-xl border border-slate-200">
                    <div className="text-slate-500">جاهزية أسطول الحافلات:</div>
                    <div className="text-lg font-bold text-blue-700 mt-0.5">{agentResult.fleetHealthScore}</div>
                  </div>
                )}
              </div>
            )}

            {agentResult.findings && (
              <div className="space-y-2">
                <div className="font-bold text-slate-900">نتائج الفحص والملاحظات المباشرة:</div>
                <div className="space-y-1.5">
                  {agentResult.findings.map((item: string, i: number) => (
                    <div key={i} className="bg-white p-2.5 rounded-xl border border-slate-200 flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span className="text-slate-800">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {agentResult.recommendedActions && (
              <div className="space-y-2">
                <div className="font-bold text-slate-900">التوصيات الوقائية المقترحة:</div>
                <div className="space-y-1.5">
                  {agentResult.recommendedActions.map((item: string, i: number) => (
                    <div key={i} className="bg-white p-2.5 rounded-xl border border-slate-200 flex items-start gap-2">
                      <Sparkles className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      <span className="text-slate-800">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {agentResult.actionNotice && (
              <div className="bg-indigo-50 border border-indigo-200 p-3.5 rounded-xl text-indigo-900 space-y-1">
                <div className="font-bold">الإجراء الفوري المتخذ:</div>
                <p className="text-slate-700">{agentResult.actionNotice}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* AI Results Display Card (When Gemini Optimization is triggered) */}
      {aiReport && (
        <div className="bg-white border border-emerald-300 rounded-3xl p-6 md:p-8 space-y-6 shadow-sm text-slate-900 animate-fade-in">
          <div className="flex items-center justify-between border-b border-emerald-100 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-emerald-50 text-emerald-700 rounded-2xl border border-emerald-200">
                <Sparkles className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">تقرير تحسين الذكاء الاصطناعي (Gemini AI Report)</h3>
                <p className="text-xs text-slate-500">تم توليد التحسين بناءً على حالة الازدحام ومواقع الطلاب</p>
              </div>
            </div>

            <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-1 rounded-xl text-xs font-bold font-mono">
              MASARA OPTIMIZED ⚡
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl text-center">
              <TrendingUp className="w-6 h-6 text-emerald-600 mx-auto mb-1" />
              <div className="text-xs text-slate-500 font-semibold">نسبة الزيادة الكلية في الكفاءة</div>
              <div className="text-3xl font-black text-emerald-700 font-mono mt-1">
                +{aiReport.efficiencyGain}%
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl text-center">
              <Clock className="w-6 h-6 text-amber-600 mx-auto mb-1" />
              <div className="text-xs text-slate-500 font-semibold">الوقت الموفر لكل رحلة</div>
              <div className="text-3xl font-black text-amber-800 font-mono mt-1">
                {aiReport.timeSavedMins} دقيقة
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl text-center">
              <Flame className="w-6 h-6 text-teal-600 mx-auto mb-1" />
              <div className="text-xs text-slate-500 font-semibold">توفير الوقود اليومي</div>
              <div className="text-3xl font-black text-teal-700 font-mono mt-1">
                {aiReport.fuelSavedLiters} لتر
              </div>
            </div>
          </div>

          <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-2">
            <h4 className="font-bold text-sm text-slate-900">الملخص التنفيذي لخوارزمية الذكاء الاصطناعي:</h4>
            <p className="text-xs text-slate-700 leading-relaxed font-medium">{aiReport.summaryAr}</p>
          </div>

          {aiReport.recommendations && (
            <div className="space-y-2">
              <h4 className="font-bold text-xs text-slate-800">توجيهات الوكيل الذكي لغرفة العمليات:</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {aiReport.recommendations.map((rec: string, idx: number) => (
                  <div
                    key={idx}
                    className="bg-slate-50 border border-slate-200 p-3 rounded-xl text-xs text-slate-800 flex items-start gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span className="font-medium">{rec}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Grid: Traffic Incident Simulator & Ask MASARA AI Assistant */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Incident Reroute Simulator */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 space-y-4 shadow-sm text-slate-900">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
            <div className="p-2.5 bg-amber-50 text-amber-700 rounded-xl border border-amber-200">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900">محاكي إعادة التوجيه الفوري (Live Rerouting)</h3>
              <p className="text-xs text-slate-500">تجربة كشف الحوادث أو الازدحام وتحديث الخريطة تلقائياً</p>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">وصف العائق المروري المكتشف:</label>
              <input
                type="text"
                value={incidentInput}
                onChange={(e) => setIncidentInput(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-800 focus:outline-none focus:border-amber-500"
              />
            </div>

            <button
              onClick={handleRunRerouteSimulation}
              disabled={isSimulatingReroute}
              className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-3 rounded-xl text-xs shadow-2xs transition-colors disabled:opacity-50"
            >
              {isSimulatingReroute ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>جاري حساب المسار البديل وتنبيه الأولياء...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  <span>محاكاة تحويل الحافلة 101 وإخطار أولياء الأمور</span>
                </>
              )}
            </button>
          </div>

          {rerouteResult && (
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl space-y-2 text-xs text-slate-900">
              <div className="font-bold text-amber-900">{rerouteResult.rerouteTitleAr}</div>
              <p className="text-slate-700 leading-relaxed font-medium">{rerouteResult.actionPlanAr}</p>
              <div className="bg-white p-3 rounded-xl border border-amber-200 text-amber-900 font-medium space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <span>💬</span>
                  <span>رسالة الإشعار التلقائية المرسلة لأولياء الأمور:</span>
                </div>
                <div className="text-slate-700 text-xs">{rerouteResult.parentAlertMessage}</div>
              </div>
            </div>
          )}
        </div>

        {/* Ask MASARA AI Assistant Widget */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 space-y-4 shadow-sm text-slate-900">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
            <div className="p-2.5 bg-blue-50 text-blue-700 rounded-xl border border-blue-200">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900">مساعد مَسارَا الذكي (MASARA AI Advisor)</h3>
              <p className="text-xs text-slate-500">استفسر عن أي تفاصيل تتعلق بالحوكمة والسلامة والمسارات</p>
            </div>
          </div>

          <form onSubmit={handleAskAdvisor} className="space-y-3">
            <div>
              <input
                type="text"
                placeholder="مثال: كيف أستطيع تقليل أوقات انتظار حافلة 101؟"
                value={advisorQuery}
                onChange={(e) => setAdvisorQuery(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
              />
            </div>

            <button
              type="submit"
              disabled={isAskingAdvisor || !advisorQuery.trim()}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl text-xs shadow-2xs transition-colors disabled:opacity-50"
            >
              {isAskingAdvisor ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>جاري استشارة الذكاء الاصطناعي...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>إرسال الاستفسار للذكاء الاصطناعي</span>
                </>
              )}
            </button>
          </form>

          {advisorAnswer && (
            <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl text-xs text-slate-800 leading-relaxed whitespace-pre-line max-h-56 overflow-y-auto font-medium">
              {advisorAnswer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
