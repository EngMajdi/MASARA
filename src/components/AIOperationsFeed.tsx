import React, { useEffect, useState, useCallback } from 'react';
import { Radio } from 'lucide-react';
import { AIRecommendation, FeedCategory, OperationsFeedEvent } from '../types';
import { listOperationsEvents } from '../services/operationsApi';
import { getRecommendation } from '../services/approvalsApi';
import { labelFor, iconFor, colorFor } from '../lib/eventDisplay';
import { AuthUser } from './AuthModal';
import { Sheet, Tabs, EmptyState, Alert } from './ui';
import type { TabItem } from './ui';

interface AIOperationsFeedProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AuthUser | null;
}

const TABS: TabItem[] = [
  { id: 'all', label: 'الكل' },
  { id: 'ai', label: 'الذكاء الاصطناعي' },
  { id: 'trips', label: 'الرحلات' },
  { id: 'students', label: 'الطلاب' },
  { id: 'approvals', label: 'الموافقات' },
  { id: 'actions', label: 'الإجراءات' },
  { id: 'verification', label: 'التحقق' },
  { id: 'safety', label: 'السلامة' }
];

export const AIOperationsFeed: React.FC<AIOperationsFeedProps> = ({ isOpen, onClose, currentUser }) => {
  const [category, setCategory] = useState<FeedCategory>('all');
  const [events, setEvents] = useState<OperationsFeedEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<OperationsFeedEvent | null>(null);
  const [selectedRec, setSelectedRec] = useState<AIRecommendation | null>(null);

  const refresh = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listOperationsEvents({ category, limit: 100, sessionToken: currentUser.sessionToken });
      setEvents(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [category, currentUser]);

  useEffect(() => {
    if (!isOpen) return;
    refresh();
    const interval = setInterval(refresh, 4000); // spec §26: 2-5s polling, no WebSockets introduced
    return () => clearInterval(interval);
  }, [isOpen, refresh]);

  useEffect(() => {
    if (!selected?.recommendationId || !currentUser) {
      setSelectedRec(null);
      return;
    }
    getRecommendation(selected.recommendationId, currentUser.sessionToken).then(setSelectedRec).catch(() => setSelectedRec(null));
  }, [selected, currentUser]);

  if (!isOpen) return null;

  return (
    <>
      <Sheet isOpen={isOpen} onClose={onClose} title="سجل عمليات الذكاء الاصطناعي" subtitle="خط زمني حي مبني على سجل التدقيق الفعلي — لا بيانات وهمية">
        <div className="space-y-4">
          <div className="overflow-x-auto">
            <Tabs items={TABS} activeId={category} onChange={(id) => setCategory(id as FeedCategory)} />
          </div>

          {error && <Alert tone="danger" title={error} />}
          {events.length === 0 && !loading && <EmptyState icon={<Radio />} title="لا توجد أحداث في هذا التصنيف حالياً" />}

          <div className="space-y-2">
            {events.map((ev) => (
              <button
                key={ev.id}
                onClick={() => setSelected(ev)}
                className={`w-full flex items-center gap-3 rounded-xl border px-4 py-2.5 text-sm text-right transition-colors hover:brightness-95 ${colorFor(ev.eventType)}`}
              >
                {iconFor(ev.eventType)}
                <span className="font-bold flex-1">{labelFor(ev.eventType)}</span>
                <span className="text-xs opacity-70">{new Date(ev.createdAt).toLocaleTimeString('ar-OM', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              </button>
            ))}
          </div>
        </div>
      </Sheet>

      {selected && (
        <Sheet isOpen onClose={() => setSelected(null)} title="تفاصيل الحدث">
          <div className="space-y-2">
            <DetailRow label="الحدث" value={labelFor(selected.eventType)} />
            <DetailRow label="النوع التقني" value={selected.eventType} />
            <DetailRow label="الوقت" value={new Date(selected.createdAt).toLocaleString('ar-OM')} />
            {selected.tripId && <DetailRow label="الرحلة" value={selected.tripId} />}
            {selected.entityType && <DetailRow label="نوع الكيان" value={selected.entityType} />}
            {selected.entityId && <DetailRow label="معرّف الكيان" value={selected.entityId} />}
            {selected.previousState && <DetailRow label="الحالة السابقة" value={selected.previousState} />}
            {selected.newState && <DetailRow label="الحالة الجديدة" value={selected.newState} />}
            {selectedRec && (
              <>
                <div className="border-t border-border-default pt-2 mt-2" />
                <DetailRow label="التوصية" value={selectedRec.title} />
                <DetailRow label="الخطورة" value={selectedRec.severity} />
                <DetailRow label="الثقة" value={`${Math.round(selectedRec.confidence * 100)}%`} />
                <DetailRow label="السبب" value={selectedRec.reason} />
              </>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-text-secondary font-medium shrink-0">{label}</span>
      <span className="text-text-primary font-bold text-left break-all">{value}</span>
    </div>
  );
}
