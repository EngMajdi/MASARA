import React, { useEffect, useState, useCallback } from 'react';
import {
  X,
  AlertTriangle,
  AlertOctagon,
  Info,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldAlert,
  RefreshCw,
  Bus as BusIcon,
  Route as RouteIcon,
  ArrowRight,
  FileText,
  History,
  Gauge,
} from 'lucide-react';
import {
  AIRecommendation,
  ActionVerification,
  AuditEvent,
  GovernedBus,
  GovernedPrediction,
  GovernedRoute,
  GovernedTrip,
  RecommendationStatus,
} from '../types';
import {
  approveRecommendationApi,
  getGovernedBus,
  getGovernedRoute,
  getPrediction,
  getRecommendationAudit,
  getRecommendationVerification,
  getTrip,
  listRecommendations,
  rejectRecommendationApi,
  requestReviewApi,
} from '../services/approvalsApi';
import { AuthUser } from './AuthModal';

interface ApprovalCenterProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AuthUser | null;
}

type TabId = 'pending' | 'approved' | 'executed' | 'rejected' | 'failed';

const TAB_STATUS_MAP: Record<TabId, RecommendationStatus[]> = {
  pending: ['pending'],
  approved: ['approved'],
  executed: ['executed', 'verified'],
  rejected: ['rejected'],
  failed: ['execution_failed', 'verification_failed', 'expired', 'cancelled'],
};

const TABS: { id: TabId; label: string }[] = [
  { id: 'pending', label: 'قيد الانتظار' },
  { id: 'approved', label: 'موافق عليها' },
  { id: 'executed', label: 'منفَّذة' },
  { id: 'rejected', label: 'مرفوضة' },
  { id: 'failed', label: 'فشل / منتهية' },
];

const ACTION_LABELS: Record<string, string> = {
  CHANGE_ROUTE: 'تغيير المسار',
  NOTIFY_SCHOOL: 'إخطار المدرسة وأولياء الأمور',
  FLAG_INCIDENT: 'تصعيد حادثة سلامة',
  NO_ACTION: 'لا يوجد إجراء',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'قيد الانتظار',
  approved: 'تمت الموافقة',
  executed: 'تم التنفيذ',
  verified: 'تم التحقق',
  rejected: 'مرفوضة',
  expired: 'منتهية الصلاحية',
  cancelled: 'ملغاة',
  execution_failed: 'فشل التنفيذ',
  verification_failed: 'فشل التحقق',
};

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, { icon: React.ReactNode; label: string; cls: string }> = {
    critical: { icon: <ShieldAlert className="w-3.5 h-3.5" />, label: 'حرج (CRITICAL)', cls: 'bg-rose-100 text-rose-800 border-rose-300' },
    high: { icon: <AlertOctagon className="w-3.5 h-3.5" />, label: 'مرتفع (HIGH)', cls: 'bg-red-50 text-red-700 border-red-200' },
    medium: { icon: <AlertTriangle className="w-3.5 h-3.5" />, label: 'متوسط (MEDIUM)', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
    low: { icon: <Info className="w-3.5 h-3.5" />, label: 'منخفض (LOW)', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  };
  const cfg = map[severity] ?? map.low;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-bold ${cfg.cls}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const successish = status === 'approved' || status === 'executed' || status === 'verified';
  const failish = status.includes('failed') || status === 'rejected' || status === 'expired' || status === 'cancelled';
  const cls = successish
    ? 'bg-blue-50 text-blue-800 border-blue-200'
    : failish
      ? 'bg-slate-100 text-slate-600 border-slate-300'
      : 'bg-amber-50 text-amber-800 border-amber-200';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-bold ${cls}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export const ApprovalCenter: React.FC<ApprovalCenterProps> = ({ isOpen, onClose, currentUser }) => {
  const [activeTab, setActiveTab] = useState<TabId>('pending');
  const [recommendations, setRecommendations] = useState<AIRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AIRecommendation | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await listRecommendations();
      setRecommendations(all);
      if (selected) {
        const updated = all.find((r) => r.id === selected.id);
        if (updated) setSelected(updated);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  useEffect(() => {
    if (!isOpen) return;
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const visibleStatuses = new Set(TAB_STATUS_MAP[activeTab]);
  const filtered = recommendations.filter((r) => visibleStatuses.has(r.status));

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto font-['Tajawal',sans-serif]">
      <div className="bg-white w-full max-w-6xl rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-black text-slate-900">مركز الموافقات</h2>
              <p className="text-xs text-slate-500 font-medium">توصيات الذكاء الاصطناعي بانتظار قرار بشري — Approval Center</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500"
              title="تحديث"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onClose} className="p-2 rounded-lg border border-slate-200 hover:bg-rose-50 text-slate-500 hover:text-rose-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1.5 px-4 sm:px-6 py-2.5 border-b border-slate-100 overflow-x-auto shrink-0 bg-slate-50/60">
          {TABS.map((tab) => {
            const count = recommendations.filter((r) => new Set(TAB_STATUS_MAP[tab.id]).has(r.status)).length;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
                  activeTab === tab.id ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`text-[10px] px-1.5 rounded-full ${
                    activeTab === tab.id ? 'bg-white/20' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50/50">
          {error && (
            <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-800 text-sm font-semibold rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          {filtered.length === 0 && !loading && (
            <div className="text-center text-slate-400 font-medium py-16">لا توجد توصيات في هذا التصنيف حالياً.</div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((rec) => (
              <RecommendationCard key={rec.id} rec={rec} onReview={() => setSelected(rec)} />
            ))}
          </div>
        </div>
      </div>

      {selected && (
        <RecommendationDetail
          rec={selected}
          currentUser={currentUser}
          onClose={() => setSelected(null)}
          onDecided={() => {
            setSelected(null);
            refresh();
          }}
        />
      )}
    </div>
  );
};

function RecommendationCard({ rec, onReview }: { rec: AIRecommendation; onReview: () => void }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <SeverityBadge severity={rec.severity} />
        <StatusBadge status={rec.status} />
      </div>

      <div>
        <h3 className="font-black text-slate-900 text-sm leading-snug">{rec.title}</h3>
        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{rec.problem}</p>
      </div>

      <div className="flex items-center gap-3 text-[11px] text-slate-500 font-semibold">
        <span className="flex items-center gap-1">
          <Gauge className="w-3.5 h-3.5 text-blue-500" />
          الثقة: {Math.round(rec.confidence * 100)}%
        </span>
        <span className="flex items-center gap-1">
          <FileText className="w-3.5 h-3.5 text-slate-400" />
          {ACTION_LABELS[rec.action] ?? rec.action}
        </span>
      </div>

      {rec.expectedOutcome && (
        <div className="text-[11px] bg-blue-50 text-blue-800 border border-blue-100 rounded-lg px-2.5 py-1.5 font-semibold">
          {rec.expectedOutcome}
        </div>
      )}

      <button
        onClick={onReview}
        className="mt-1 flex items-center justify-center gap-1.5 bg-slate-900 hover:bg-black text-white text-xs font-bold py-2 rounded-lg transition-colors"
      >
        مراجعة
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function RecommendationDetail({
  rec,
  currentUser,
  onClose,
  onDecided,
}: {
  rec: AIRecommendation;
  currentUser: AuthUser | null;
  onClose: () => void;
  onDecided: () => void;
}) {
  const [trip, setTrip] = useState<GovernedTrip | null>(null);
  const [bus, setBus] = useState<GovernedBus | null>(null);
  const [route, setRoute] = useState<GovernedRoute | null>(null);
  const [targetRoute, setTargetRoute] = useState<GovernedRoute | null>(null);
  const [prediction, setPrediction] = useState<GovernedPrediction | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [verification, setVerification] = useState<ActionVerification | null>(null);

  const [showConfirm, setShowConfirm] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [t, a] = await Promise.all([getTrip(rec.tripId), getRecommendationAudit(rec.id)]);
        if (cancelled) return;
        setTrip(t);
        setAudit(a);
        const [b, r, p, v] = await Promise.all([
          getGovernedBus(t.busId).catch(() => null),
          getGovernedRoute(t.routeId).catch(() => null),
          rec.predictionId ? getPrediction(rec.predictionId).catch(() => null) : Promise.resolve(null),
          getRecommendationVerification(rec.id).catch(() => null),
        ]);
        if (cancelled) return;
        setBus(b);
        setRoute(r);
        setPrediction(p);
        setVerification(v);
        if (rec.action === 'CHANGE_ROUTE' && rec.targetId) {
          getGovernedRoute(rec.targetId)
            .then((tr) => !cancelled && setTargetRoute(tr))
            .catch(() => {});
        }
      } catch {
        // Detail context is supplementary — the decision buttons still work without it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rec.id, rec.tripId, rec.predictionId, rec.action, rec.targetId]);

  const isPending = rec.status === 'pending';
  const isExpired = rec.status === 'pending' && rec.expiresAt && new Date(rec.expiresAt).getTime() < Date.now();

  async function handleApprove() {
    if (!currentUser) return;
    setBusy(true);
    setActionError(null);
    try {
      await approveRecommendationApi(rec.id, currentUser.email);
      setShowConfirm(false);
      onDecided();
    } catch (err) {
      setActionError((err as Error).message);
      setShowConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    if (!currentUser || !rejectReason.trim()) return;
    setBusy(true);
    setActionError(null);
    try {
      await rejectRecommendationApi(rec.id, currentUser.email, rejectReason.trim());
      onDecided();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestReview() {
    if (!currentUser) return;
    setBusy(true);
    setActionError(null);
    try {
      await requestReviewApi(rec.id, currentUser.email);
      onDecided();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto font-['Tajawal',sans-serif]">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <SeverityBadge severity={rec.severity} />
            <StatusBadge status={isExpired ? 'expired' : rec.status} />
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div>
            <h3 className="text-lg font-black text-slate-900">{rec.title}</h3>
            <p className="text-sm text-slate-600 mt-1">{rec.problem}</p>
          </div>

          {/* Situation */}
          <Section title="الموقف الحالي (Situation)" icon={<BusIcon className="w-4 h-4" />}>
            <Field label="الحافلة" value={bus ? `${bus.busNumber} (${bus.status})` : '—'} />
            <Field label="المسار الحالي" value={route ? `${route.name} · ${route.estimatedDurationMins} دقيقة` : '—'} />
            <Field label="حالة الرحلة" value={trip?.status ?? '—'} />
            <Field
              label="الوقت المحدد للوصول الحالي"
              value={trip?.currentEtaAt ? new Date(trip.currentEtaAt).toLocaleTimeString('ar-OM', { hour: '2-digit', minute: '2-digit' }) : '—'}
            />
          </Section>

          {/* Detection */}
          <Section title="الاكتشاف (Detection)" icon={<AlertTriangle className="w-4 h-4" />}>
            <Field label="المشكلة المكتشفة" value={rec.problem} />
            <Field label="وقت الاكتشاف" value={new Date(rec.createdAt).toLocaleString('ar-OM')} />
          </Section>

          {/* AI Prediction */}
          <Section title="تنبؤ الذكاء الاصطناعي (AI Prediction)" icon={<Gauge className="w-4 h-4" />}>
            <Field label="التأخير المتوقع" value={prediction ? `${prediction.delayMinutes} دقيقة` : '—'} />
            <Field label="احتمال التأخير" value={prediction ? `${Math.round(prediction.delayProbability * 100)}%` : '—'} />
            <Field label="مستوى الثقة" value={`${Math.round(rec.confidence * 100)}%`} />
          </Section>

          {/* Recommended Action */}
          <Section title="الإجراء الموصى به (Recommended Action)" icon={<RouteIcon className="w-4 h-4" />}>
            <Field label="الإجراء" value={ACTION_LABELS[rec.action] ?? rec.action} />
            {targetRoute && <Field label="المسار المقترح" value={`${targetRoute.name} · ${targetRoute.estimatedDurationMins} دقيقة`} />}
            <Field label="السبب" value={rec.reason} />
            <Field label="النتيجة المتوقعة" value={rec.expectedOutcome ?? '—'} />
          </Section>

          {/* Governance */}
          <Section title="الحوكمة (Governance)" icon={<ShieldAlert className="w-4 h-4" />}>
            <Field label="مستوى الخطورة" value={rec.severity} />
            <Field label="تتطلب موافقة بشرية" value={rec.requiresApproval ? 'نعم' : 'لا'} />
            <Field
              label="صلاحية التوصية"
              value={rec.expiresAt ? new Date(rec.expiresAt).toLocaleString('ar-OM') : '—'}
            />
            {rec.decidedByUserId && (
              <Field label="اتُخذ القرار بواسطة" value={`${rec.decidedByUserId} — ${rec.decidedAt ? new Date(rec.decidedAt).toLocaleString('ar-OM') : ''}`} />
            )}
            {rec.rejectionReason && <Field label="سبب الرفض" value={rec.rejectionReason} />}
          </Section>

          {verification && (
            <Section title="نتيجة التحقق (Verification)" icon={<CheckCircle2 className="w-4 h-4" />}>
              <Field
                label="الحالة"
                value={verification.status === 'success' ? 'نجاح' : verification.status === 'partial_success' ? 'نجاح جزئي' : 'فشل'}
              />
              <Field label="التحسين الفعلي" value={verification.improvementMins != null ? `${verification.improvementMins} دقيقة` : '—'} />
            </Section>
          )}

          {audit.length > 0 && (
            <Section title="سجل التدقيق (Audit Trail)" icon={<History className="w-4 h-4" />}>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {audit.map((ev) => (
                  <div key={ev.id} className="flex items-center justify-between text-[11px] text-slate-600 border-b border-slate-100 pb-1">
                    <span className="font-bold text-slate-800">{ev.eventType}</span>
                    <span className="font-mono text-slate-400">{new Date(ev.createdAt).toLocaleTimeString('ar-OM')}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {actionError && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 text-sm font-semibold rounded-xl px-4 py-3">
              {actionError}
            </div>
          )}

          {isExpired && (
            <div className="bg-slate-100 border border-slate-300 text-slate-600 text-sm font-semibold rounded-xl px-4 py-3 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              انتهت صلاحية هذه التوصية — لم تعد قابلة للموافقة أو الرفض.
            </div>
          )}
        </div>

        {/* Decision */}
        {isPending && !isExpired && (
          <div className="border-t border-slate-200 p-4 shrink-0 bg-slate-50/70">
            {!showRejectForm ? (
              <div className="flex items-center gap-2">
                <button
                  disabled={busy}
                  onClick={() => setShowConfirm(true)}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold py-2.5 rounded-xl transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  الموافقة
                </button>
                <button
                  disabled={busy}
                  onClick={() => setShowRejectForm(true)}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-sm font-bold py-2.5 rounded-xl transition-colors"
                >
                  <XCircle className="w-4 h-4" />
                  الرفض
                </button>
                <button
                  disabled={busy}
                  onClick={handleRequestReview}
                  className="flex items-center justify-center gap-1.5 bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-50 text-slate-700 text-sm font-bold py-2.5 px-3 rounded-xl transition-colors"
                >
                  طلب مراجعة
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700">سبب الرفض (مطلوب)</label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={2}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none"
                  placeholder="اكتب سبب رفض هذه التوصية..."
                />
                <div className="flex items-center gap-2">
                  <button
                    disabled={busy || !rejectReason.trim()}
                    onClick={handleReject}
                    className="flex-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white text-sm font-bold py-2 rounded-lg"
                  >
                    تأكيد الرفض
                  </button>
                  <button
                    onClick={() => {
                      setShowRejectForm(false);
                      setRejectReason('');
                    }}
                    className="px-4 bg-white border border-slate-300 text-slate-600 text-sm font-bold py-2 rounded-lg"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-[70] bg-slate-950/70 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-5 space-y-4">
            <h3 className="font-black text-slate-900 text-base">تأكيد الإجراء التشغيلي</h3>
            <p className="text-sm text-slate-600">
              أنت على وشك الموافقة على: <strong className="text-slate-900">{rec.title}</strong>
            </p>
            {rec.expectedOutcome && (
              <div className="text-sm bg-blue-50 border border-blue-100 text-blue-800 rounded-lg px-3 py-2 font-semibold">
                النتيجة المتوقعة: {rec.expectedOutcome}
              </div>
            )}
            <div className="flex items-center gap-2">
              <SeverityBadge severity={rec.severity} />
              <span className="text-xs text-slate-500 font-semibold">سيتم تسجيل هذا الإجراء في سجل التدقيق.</span>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button
                disabled={busy}
                onClick={() => setShowConfirm(false)}
                className="flex-1 bg-white border border-slate-300 text-slate-700 font-bold py-2.5 rounded-xl text-sm"
              >
                إلغاء
              </button>
              <button
                disabled={busy}
                onClick={handleApprove}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-sm"
              >
                {busy ? 'جارٍ التنفيذ...' : 'تأكيد الموافقة'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border border-slate-200 rounded-xl p-3.5">
      <div className="flex items-center gap-1.5 text-xs font-black text-slate-500 mb-2.5">
        {icon}
        {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="text-slate-500 font-semibold shrink-0">{label}</span>
      <span className="text-slate-800 font-bold text-left">{value}</span>
    </div>
  );
}
