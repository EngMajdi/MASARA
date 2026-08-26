import React from 'react';
import { SystemNotification } from '../types';
import { CheckCircle2, AlertTriangle, Info, Bell } from 'lucide-react';
import { Sheet, Card, EmptyState, Button } from './ui';
import type { Tone } from './ui';

interface NotificationsModalProps {
  notifications: SystemNotification[];
  onClose: () => void;
  onClear: () => void;
}

const TYPE_TONE: Record<SystemNotification['type'], { tone: Tone; icon: React.ReactNode }> = {
  success: { tone: 'success', icon: <CheckCircle2 className="w-4 h-4 text-emerald-600" /> },
  alert: { tone: 'warning', icon: <AlertTriangle className="w-4 h-4 text-amber-600" /> },
  warning: { tone: 'danger', icon: <AlertTriangle className="w-4 h-4 text-rose-600" /> },
  info: { tone: 'info', icon: <Info className="w-4 h-4 text-sky-600" /> }
};

export const NotificationsModal: React.FC<NotificationsModalProps> = ({ notifications, onClose, onClear }) => (
  <Sheet
    isOpen
    onClose={onClose}
    title="الإشعارات"
    footer={
      notifications.length > 0 ? (
        <Button variant="ghost" size="sm" onClick={onClear} className="text-danger">
          مسح الكل
        </Button>
      ) : undefined
    }
  >
    {notifications.length === 0 ? (
      <EmptyState icon={<Bell />} title="لا توجد إشعارات" description="ستظهر هنا التنبيهات المهمة فور توفرها." />
    ) : (
      <div className="space-y-2.5">
        {notifications.map((notif) => {
          const cfg = TYPE_TONE[notif.type];
          return (
            <Card key={notif.id} padding="sm">
              <div className="flex items-start gap-2.5">
                <span className="shrink-0 mt-0.5">{cfg.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-sm text-text-primary">{notif.title}</p>
                    <span className="text-xs text-text-tertiary shrink-0">{notif.timestamp}</span>
                  </div>
                  <p className="text-sm text-text-secondary mt-0.5 leading-relaxed">{notif.message}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    )}
  </Sheet>
);
