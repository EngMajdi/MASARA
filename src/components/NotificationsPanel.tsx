import React, { useEffect, useState } from 'react';
import { NotificationView } from '../types';
import { getParentNotifications, markNotificationRead } from '../services/notificationApi';
import { Bell, Bus, MapPin, DoorOpen, AlertTriangle, Siren, Loader2 } from 'lucide-react';
import { Card, ErrorState } from './ui';
import type { Tone } from './ui';

interface NotificationsPanelProps {
  userEmail: string;
}

const POLL_MS = 10000;

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  BOARDING: <Bus className="w-4 h-4" />,
  ARRIVAL: <MapPin className="w-4 h-4" />,
  DROPPED_OFF: <DoorOpen className="w-4 h-4" />,
  STATUS: <AlertTriangle className="w-4 h-4" />,
  INCIDENT: <Siren className="w-4 h-4" />
};

const PRIORITY_TONE: Record<string, Tone> = { LOW: 'neutral', NORMAL: 'info', HIGH: 'warning', CRITICAL: 'danger' };

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

const TONE_ICON_CLASSES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-500',
  info: 'bg-info-soft text-sky-600',
  warning: 'bg-warning-soft text-amber-600',
  danger: 'bg-danger-soft text-rose-600',
  success: 'bg-success-soft text-emerald-600'
};

/**
 * Governed Notifications (Phase 5B) — reads ONLY the server-produced,
 * deterministic notification record; no internal IDs/GPS/AI details are
 * ever rendered here (see notificationContract.ts). Folded into the
 * Parent portal's single "الإشعارات" section (see ParentPortal.tsx) so a
 * parent sees one feed rather than two competing notification lists.
 */
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

  const handleMarkRead = (id: string) => {
    markNotificationRead(id, userEmail)
      .then((updated) => setItems((prev) => (prev ? prev.map((n) => (n.id === updated.id ? updated : n)) : prev)))
      .catch(() => {
        /* silent — next poll re-syncs the true state */
      });
  };

  if (loading && !items) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-text-secondary text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>جاري تحميل الإشعارات...</span>
      </div>
    );
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!items || items.length === 0) return null;

  return (
    <div className="space-y-2.5">
      {items.map((n) => {
        const tone = PRIORITY_TONE[n.priority] ?? 'info';
        return (
          <Card key={n.id} padding="sm" interactive={!n.readAt} onClick={() => !n.readAt && handleMarkRead(n.id)} className={n.readAt ? 'opacity-60' : ''}>
            <div className="flex items-start gap-2.5">
              <span className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${TONE_ICON_CLASSES[tone]}`}>
                {CATEGORY_ICON[n.category] ?? <Bell className="w-4 h-4" />}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-sm text-text-primary">{n.title}</span>
                  {!n.readAt && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                </div>
                <p className="text-sm text-text-secondary mt-0.5 leading-relaxed">{n.body}</p>
                <span className="text-xs text-text-tertiary mt-1 block">{timeAgo(n.createdAt)}</span>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
};
