import React, { useEffect, useState, useCallback } from 'react';
import {
  AlertTriangle,
  AlertOctagon,
  Info,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldAlert,
  Bus as BusIcon,
  Route as RouteIcon,
  ArrowLeft,
  FileText,
  History,
  Gauge
} from 'lucide-react';
import {
  AIRecommendation,
  ActionVerification,
  AuditEvent,
  GovernedBus,
  GovernedPrediction,
  GovernedRoute,
  GovernedTrip,
  RecommendationStatus
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
  requestReviewApi
} from '../services/approvalsApi';
import { AuthUser } from './AuthModal';
import { Sheet, Tabs, Card, Badge, Button, ConfirmDialog, Alert, EmptyState, Textarea } from './ui';
import type { Tone, TabItem } from './ui';

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
  failed: ['execution_failed', 'verification_failed', 'expired', 'cancelled']
};

const TABS: TabItem[] = [
  { id: 'pending', label: 'قيد الانتظار' },
  { id: 'approved', label: 'موافق عليها' },
  { id: 'executed', label: 'منفَّذة' },
  { id: 'rejected', label: 'مرفوضة' },
  { id: 'failed', label: 'فشل / منتهية' }
];

const ACTION_LABELS: Record<string, string> = {
  CHANGE_ROUTE: 'تغيير المسار',
  NOTIFY_SCHOOL: 'إخطار المدرسة وأولياء الأمور',
  FLAG_INCIDENT: 'تصعيد حادثة سلامة',
  NO_ACTION: 'لا يوجد إجراء'
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
  verification_failed: 'فشل التحقق'
};

const SEVERITY_TONE: Record<string, Tone> = { critical: 'danger', high: 'danger', medium: 'warning', low: 'success' };
const SEVERITY_ICON: Record<string, React.ReactNode> = {
  critical: <ShieldAlert className="w-3.5 h-3.5" />,
  high: <AlertOctagon className="w-3.5 h-3.5" />,
  medium: <AlertTriangle className="w-3.5 h-3.5" />,
  low: <Info className="w-3.5 h-3.5" />
};

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge tone={SEVERITY_TONE[severity] ?? 'neutral'} icon={SEVERITY_ICON[severity]}>
      {STATUS_LABELS[severity] ?? severity}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone: Tone = status === 'approved' || status === 'executed' || status === 'verified' ? 'info' : status.includes('failed') || status === 'rejected' || status === 'expired' || status === 'cancelled' ? 'neutral' : 'warning';
  return <Badge tone={tone}>{STATUS_LABELS[status] ?? status}</Badge>;
}

export const ApprovalCenter: React.FC<ApprovalCenterProps> = ({ isOpen, onClose, currentUser }) => {
  const [activeTab, setActiveTab] = useState<TabId>('pending');
  const [recommendations, setRecommendations] = useState<AIRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AIRecommendation | null>(null);

  const refresh = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    setError(null);
    try {
      const all = await listRecommendations(currentUser.sessionToken);
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
    <>
      <Sheet isOpen={isOpen} onClose={onClose} title="مركز الموافقات" subtitle="توصيات الذكاء الاصطناعي بانتظار قرار بشري">
        <div className="space-y-4">
          {error && <Alert tone="danger" title={error} />}

          <div className="overflow-x-auto">
            <Tabs items={TABS} activeId={activeTab} onChange={(id) => setActiveTab(id as TabId)} />
          </div>

          {filtered.length === 0 && !loading ? (
            <EmptyState icon={<ShieldAlert />} title="لا توجد توصيات في هذا التصنيف" />
          ) : (
            <div className="space-y-3">
              {filtered.map((rec) => (
                <Card key={rec.id} padding="sm" className="space-y-3">
                  <div className="flex items-center justify-between">
                    <SeverityBadge severity={rec.severity} />
                    <StatusBadge status={rec.status} />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-text-primary">{rec.title}</h3>
                    <p className="text-xs text-text-secondary mt-1 line-clamp-2">{rec.problem}</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-text-secondary font-medium">
                    <span className="flex items-center gap-1"><Gauge className="w-3.5 h-3.5 text-primary" />الثقة: {Math.round(rec.confidence * 100)}%</span>
                    <span className="flex items-center gap-1"><FileText className="w-3.5 h-3.5 text-text-tertiary" />{ACTION_LABELS[rec.action] ?? rec.action}</span>
                  </div>
                  <Button variant="secondary" size="sm" fullWidth icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={() => setSelected(rec)}>
                    مراجعة
                  </Button>
                </Card>
              ))}
            </div>
          )}
        </div>
      </Sheet>

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
    </>
  );
};

function RecommendationDetail({ rec, currentUser, onClose, onDecided }: { rec: AIRecommendation; currentUser: AuthUser | null; onClose: () => void; onDecided: () => void }) {
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
    if (!currentUser) return;
    const sessionToken = currentUser.sessionToken;
    let cancelled = false;
    (async () => {
      try {
        const [t, a] = await Promise.all([getTrip(rec.tripId, sessionToken), getRecommendationAudit(rec.id, sessionToken)]);
        if (cancelled) return;
        setTrip(t);
        setAudit(a);
        const [b, r, p, v] = await Promise.all([
          getGovernedBus(t.busId, sessionToken).catch(() => null),
          getGovernedRoute(t.routeId, sessionToken).catch(() => null),
          rec.predictionId ? getPrediction(rec.predictionId, sessionToken).catch(() => null) : Promise.resolve(null),
          getRecommendationVerification(rec.id, sessionToken).catch(() => null)
        ]);
        if (cancelled) return;
        setBus(b);
        setRoute(r);
        setPrediction(p);
        setVerification(v);
        if (rec.action === 'CHANGE_ROUTE' && rec.targetId) {
          getGovernedRoute(rec.targetId, sessionToken).then((tr) => !cancelled && setTargetRoute(tr)).catch(() => {});
        }
      } catch {
        // Detail context is supplementary — the decision buttons still work without it.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.id, rec.tripId, rec.predictionId, rec.action, rec.targetId, currentUser?.sessionToken]);

  const isPending = rec.status === 'pending';
  const isExpired = rec.status === 'pending' && !!rec.expiresAt && new Date(rec.expiresAt).getTime() < Date.now();

  async function handleApprove() {
    if (!currentUser) return;
    setBusy(true);
    setActionError(null);
    try {
      await approveRecommendationApi(rec.id, currentUser.sessionToken);
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
      await rejectRecommendationApi(rec.id, currentUser.sessionToken, rejectReason.trim());
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
      await requestReviewApi(rec.id, currentUser.sessionToken);
      onDecided();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Sheet
        isOpen
        onClose={onClose}
        title={rec.title}
        footer={
          isPending && !isExpired ? (
            !showRejectForm ? (
              <div className="flex items-center gap-2">
                <Button variant="success" fullWidth disabled={busy} icon={<CheckCircle2 className="w-4 h-4" />} onClick={() => setShowConfirm(true)}>
                  الموافقة
                </Button>
                <Button variant="danger" fullWidth disabled={busy} icon={<XCircle className="w-4 h-4" />} onClick={() => setShowRejectForm(true)}>
                  الرفض
                </Button>
                <Button variant="secondary" disabled={busy} onClick={handleRequestReview}>
                  طلب مراجعة
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-xs font-bold text-text-secondary">سبب الرفض (مطلوب)</label>
                <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="اكتب سبب رفض هذه التوصية..." />
                <div className="flex items-center gap-2">
                  <Button variant="danger" fullWidth disabled={busy || !rejectReason.trim()} onClick={handleReject}>تأكيد الرفض</Button>
                  <Button variant="secondary" onClick={() => { setShowRejectForm(false); setRejectReason(''); }}>إلغاء</Button>
                </div>
              </div>
            )
          ) : undefined
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <SeverityBadge severity={rec.severity} />
            <StatusBadge status={isExpired ? 'expired' : rec.status} />
          </div>

          <p className="text-sm text-text-secondary">{rec.problem}</p>

          <Section title="الموقف الحالي" icon={<BusIcon className="w-4 h-4" />}>
            <Field label="الحافلة" value={bus ? `${bus.busNumber} (${bus.status})` : '—'} />
            <Field label="المسار الحالي" value={route ? `${route.name} · ${route.estimatedDurationMins} دقيقة` : '—'} />
            <Field label="حالة الرحلة" value={trip?.status ?? '—'} />
            <Field label="الوقت المحدد للوصول" value={trip?.currentEtaAt ? new Date(trip.currentEtaAt).toLocaleTimeString('ar-OM', { hour: '2-digit', minute: '2-digit' }) : '—'} />
          </Section>

          <Section title="تنبؤ الذكاء الاصطناعي" icon={<Gauge className="w-4 h-4" />}>
            <Field label="التأخير المتوقع" value={prediction ? `${prediction.delayMinutes} دقيقة` : '—'} />
            <Field label="احتمال التأخير" value={prediction ? `${Math.round(prediction.delayProbability * 100)}%` : '—'} />
            <Field label="مستوى الثقة" value={`${Math.round(rec.confidence * 100)}%`} />
          </Section>

          <Section title="الإجراء الموصى به" icon={<RouteIcon className="w-4 h-4" />}>
            <Field label="الإجراء" value={ACTION_LABELS[rec.action] ?? rec.action} />
            {targetRoute && <Field label="المسار المقترح" value={`${targetRoute.name} · ${targetRoute.estimatedDurationMins} دقيقة`} />}
            <Field label="السبب" value={rec.reason} />
            <Field label="النتيجة المتوقعة" value={rec.expectedOutcome ?? '—'} />
          </Section>

          <Section title="الحوكمة" icon={<ShieldAlert className="w-4 h-4" />}>
            <Field label="مستوى الخطورة" value={rec.severity} />
            <Field label="تتطلب موافقة بشرية" value={rec.requiresApproval ? 'نعم' : 'لا'} />
            <Field label="صلاحية التوصية" value={rec.expiresAt ? new Date(rec.expiresAt).toLocaleString('ar-OM') : '—'} />
            {rec.decidedByUserId && <Field label="اتُخذ القرار بواسطة" value={`${rec.decidedByUserId} — ${rec.decidedAt ? new Date(rec.decidedAt).toLocaleString('ar-OM') : ''}`} />}
            {rec.rejectionReason && <Field label="سبب الرفض" value={rec.rejectionReason} />}
          </Section>

          {verification && (
            <Section title="نتيجة التحقق" icon={<CheckCircle2 className="w-4 h-4" />}>
              <Field label="الحالة" value={verification.status === 'success' ? 'نجاح' : verification.status === 'partial_success' ? 'نجاح جزئي' : 'فشل'} />
              <Field label="التحسين الفعلي" value={verification.improvementMins != null ? `${verification.improvementMins} دقيقة` : '—'} />
            </Section>
          )}

          {audit.length > 0 && (
            <Section title="سجل التدقيق" icon={<History className="w-4 h-4" />}>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {audit.map((ev) => (
                  <div key={ev.id} className="flex items-center justify-between text-xs text-text-secondary border-b border-border-default pb-1">
                    <span className="font-bold text-text-primary">{ev.eventType}</span>
                    <span className="text-text-tertiary">{new Date(ev.createdAt).toLocaleTimeString('ar-OM')}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {actionError && <Alert tone="danger" title={actionError} />}

          {isExpired && (
            <Alert tone="neutral" title="انتهت صلاحية هذه التوصية" description="لم تعد قابلة للموافقة أو الرفض." />
          )}
        </div>
      </Sheet>

      <ConfirmDialog
        isOpen={showConfirm}
        tone="info"
        title="تأكيد الإجراء التشغيلي"
        description={`أنت على وشك الموافقة على: ${rec.title}${rec.expectedOutcome ? ` — ${rec.expectedOutcome}` : ''}. سيتم تسجيل هذا الإجراء في سجل التدقيق.`}
        confirmLabel={busy ? 'جارٍ التنفيذ...' : 'تأكيد الموافقة'}
        confirmLoading={busy}
        onConfirm={handleApprove}
        onCancel={() => setShowConfirm(false)}
      />
    </>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border border-border-default rounded-xl p-3.5">
      <div className="flex items-center gap-1.5 text-xs font-bold text-text-secondary mb-2.5">
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
      <span className="text-text-secondary font-medium shrink-0">{label}</span>
      <span className="text-text-primary font-bold text-left">{value}</span>
    </div>
  );
}
