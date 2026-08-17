import React, { useEffect, useState, useCallback } from 'react';
import { X, RefreshCw, Radio } from 'lucide-react';
import { AIRecommendation, FeedCategory, OperationsFeedEvent } from '../types';
import { listOperationsEvents } from '../services/operationsApi';
import { getRecommendation } from '../services/approvalsApi';
import { labelFor, iconFor, colorFor } from '../lib/eventDisplay';
import { AuthUser } from './AuthModal';

interface AIOperationsFeedProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AuthUser | null;
}

const TABS: { id: FeedCategory; label: string }[] = [
  { id: 'all', label: 'الكل' },
  { id: 'ai', label: 'الذكاء الاصطناعي' },
  { id: 'trips', label: 'الرحلات' },
  { id: 'students', label: 'الطلاب' },
  { id: 'approvals', label: 'الموافقات' },
  { id: 'actions', label: 'الإجراءات' },
  { id: 'verification', label: 'التحقق' },
  { id: 'safety', label: 'السلامة' },
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
      const data = await listOperationsEvents({ category, limit: 100, userEmail: currentUser.email });
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
    if (!selected?.recommendationId) {
      setSelectedRec(null);
      return;
    }
    getRecommendation(selected.recommendationId)
      .then(setSelectedRec)
      .catch(() => setSelectedRec(null));
  }, [selected]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto font-['Tajawal',sans-serif]">
      <div className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-md">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-black text-slate-900">عمليات مَسارَا الذكية (AI Operations)</h2>
              <p className="text-xs text-slate-500 font-medium">خط زمني حي مبني على سجل التدقيق الفعلي — لا بيانات وهمية</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={refresh} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500" title="تحديث">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onClose} className="p-2 rounded-lg border border-slate-200 hover:bg-rose-50 text-slate-500 hover:text-rose-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 px-4 sm:px-6 py-2.5 border-b border-slate-100 overflow-x-auto shrink-0 bg-slate-50/60">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setCategory(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
                category === tab.id ? 'bg-slate-900 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50/50">
          {error && <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-800 text-sm font-semibold rounded-xl px-4 py-3">{error}</div>}
          {events.length === 0 && !loading && <div className="text-center text-slate-400 font-medium py-16">لا توجد أحداث في هذا التصنيف حالياً.</div>}

          <div className="space-y-2">
            {events.map((ev) => (
              <button
                key={ev.id}
                onClick={() => setSelected(ev)}
                className={`w-full flex items-center gap-3 rounded-xl border px-4 py-2.5 text-sm text-right transition-colors hover:brightness-95 ${colorFor(ev.eventType)}`}
              >
                {iconFor(ev.eventType)}
                <span className="font-bold flex-1">{labelFor(ev.eventType)}</span>
                <span className="font-mono text-xs opacity-70">
                  {new Date(ev.createdAt).toLocaleTimeString('ar-OM', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-[60] bg-slate-950/70 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-black text-slate-900">تفاصيل الحدث (Event Details)</h3>
              <button onClick={() => setSelected(null)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
                <X className="w-4 h-4" />
              </button>
            </div>
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
                <div className="border-t border-slate-100 pt-2 mt-2" />
                <DetailRow label="التوصية" value={selectedRec.title} />
                <DetailRow label="الخطورة" value={selectedRec.severity} />
                <DetailRow label="الثقة" value={`${Math.round(selectedRec.confidence * 100)}%`} />
                <DetailRow label="السبب" value={selectedRec.reason} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="text-slate-500 font-semibold shrink-0">{label}</span>
      <span className="text-slate-800 font-bold text-left break-all">{value}</span>
    </div>
  );
}
