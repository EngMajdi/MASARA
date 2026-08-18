import React, { useEffect, useState } from 'react';
import { NotificationView } from '../types';
import { getParentNotifications, markNotificationRead } from '../services/notificationApi';
import { Bell, Bus, MapPin, DoorOpen, AlertTriangle, Siren, RefreshCw, Inbox, AlertOctagon } from 'lucide-react';

interface NotificationsPanelProps {
  userEmail: string;
}

const POLL_MS = 10000;

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  BOARDING: <Bus className="w-4 h-4" />,
  ARRIVAL: <MapPin className="w-4 h-4" />,
  DROPPED_OFF: <DoorOpen className="w-4 h-4" />,
  STATUS: <AlertTriangle className="w-4 h-4" />,
  INCIDENT: <Siren className="w-4 h-4" />,
};

const PRIORITY_STYLES: Record<string, string> = {
  LOW: 'border-slate-200 bg-slate-50',
  NORMAL: 'border-slate-200 bg-slate-50',
  HIGH: 'border-amber-200 bg-amber-50',
  CRITICAL: 'border-rose-300 bg-rose-50',
};

const PRIORITY_ICON_COLOR: Record<string, string> = {
  LOW: 'text-slate-500',
  NORMAL: 'text-blue-600',
  HIGH: 'text-amber-600',
  CRITICAL: 'text-rose-600',
};

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'الآن';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.round(hours / 24);
  return `منذ ${days} يوم`;
}

// Governed Notifications (Phase 5B) — reads ONLY the server-produced,
// deterministic notification record. No eventType, no internal IDs, no GPS
// coordinates, no AI/governance information is ever rendered here — the
// server DTO simply doesn't carry any of that (see notificationContract.ts).
export const NotificationsPanel: React.FC<NotificationsPanelProps> = ({ userEmail }) => {
  const [items, setItems] = useState<NotificationView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    getParentNotifications(userEmail)
      .then((data) => {
        setItems(data);
        setError(null);
      })
      .catch((err) => setError(err.message || 'تعذر تحميل الإشعارات.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setLoading(true);
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail]);

  const unreadCount = items?.filter((n) => !n.readAt).length ?? 0;

  const handleMarkRead = (id: string) => {
    // Optimistic-but-honest: update local read state only after the server confirms it (never fabricate the mutation's result).
    markNotificationRead(id, userEmail)
      .then((updated) => setItems((prev) => (prev ? prev.map((n) => (n.id === updated.id ? updated : n)) : prev)))
      .catch(() => {
        /* silent — next poll re-syncs the true state */
      });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
          <Bell className="w-4 h-4 text-blue-600" />
          <span>الإشعارات</span>
        </h3>
        {unreadCount > 0 && (
          <span className="bg-rose-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center">{unreadCount}</span>
        )}
      </div>

      {loading && !items ? (
        <div className="flex items-center justify-center gap-2 py-6 text-slate-500 text-xs font-medium">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>جاري تحميل الإشعارات...</span>
        </div>
      ) : error ? (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-rose-800 text-xs flex items-center gap-2">
          <AlertOctagon className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : !items || items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-6 text-slate-400 text-xs font-medium">
          <Inbox className="w-6 h-6" />
          <span>لا توجد إشعارات حالياً.</span>
        </div>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => !n.readAt && handleMarkRead(n.id)}
              className={`w-full text-right rounded-xl border px-3 py-2.5 text-xs transition-colors ${PRIORITY_STYLES[n.priority] ?? PRIORITY_STYLES.NORMAL} ${
                n.readAt ? 'opacity-60' : ''
              }`}
            >
              <div className="flex items-start gap-2.5">
                <span className={`shrink-0 mt-0.5 ${PRIORITY_ICON_COLOR[n.priority] ?? PRIORITY_ICON_COLOR.NORMAL}`}>
                  {CATEGORY_ICON[n.category] ?? <Bell className="w-4 h-4" />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-bold text-slate-900 ${n.readAt ? '' : 'font-black'}`}>{n.title}</span>
                    {!n.readAt && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 shrink-0" />}
                  </div>
                  <p className="text-slate-600 mt-0.5 leading-relaxed">{n.body}</p>
                  <span className="text-[10px] text-slate-400 mt-1 block">{timeAgo(n.createdAt)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
