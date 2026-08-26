import React, { useEffect, useState } from 'react';
import { Student, Bus, SystemNotification } from '../types';
import { AuthUser } from './AuthModal';
import { legacyAuthHeaders } from '../services/legacyAuthHeaders';
import { ChildDetailSheet } from './parent/ChildDetailSheet';
import { NotificationsPanel } from './NotificationsPanel';
import {
  Badge,
  Card,
  EmptyState,
  Tabs,
  MobileTabBar,
  SkeletonCard,
  Metric
} from './ui';
import type { Tone, TabItem } from './ui';
import { Users, Bell, Clock, ChevronLeft, Timer, Settings2, ChevronDown, ChevronUp, Volume2, Smartphone, Check, X } from 'lucide-react';

interface ParentPortalProps {
  students: Student[];
  buses: Bus[];
  notifications: SystemNotification[];
  onUpdateStatus: (studentId: string, status: 'boarded' | 'absent') => void;
  currentUser?: AuthUser | null;
}

const STATUS_META: Record<Student['status'], { label: string; tone: Tone }> = {
  boarded: { label: 'صعد الحافلة', tone: 'success' },
  at_school: { label: 'وصل إلى المدرسة', tone: 'success' },
  waiting: { label: 'ينتظر الحافلة', tone: 'warning' },
  at_home: { label: 'في المنزل', tone: 'neutral' },
  absent: { label: 'غائب اليوم', tone: 'danger' }
};

const playChimeSound = () => {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch (e) {
    // Graceful fallback for audio policy restrictions
  }
};

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'صباح الخير';
  if (hour < 17) return 'مساء الخير';
  return 'مساء الخير';
};

const firstName = (fullName: string) => fullName.split(' ')[0] ?? fullName;

const SECTIONS: TabItem[] = [
  { id: 'children', label: 'أبنائي', icon: <Users className="w-4 h-4" /> },
  { id: 'notifications', label: 'الإشعارات', icon: <Bell className="w-4 h-4" /> }
];

/**
 * Phase 9B — complete IA rebuild. A parent's mental model is "my children
 * → their safety → notifications", not "map → data → routes → AI". The
 * first viewport now answers "is my child safe" directly: a greeting and a
 * list of children with their live status. Tapping a child opens a
 * dedicated journey detail (ChildDetailSheet) instead of a shared page
 * fighting for space with every other child. The pre-arrival alert
 * scheduler — a notification PREFERENCE, not primary content — now lives
 * inside the Notifications section instead of dominating the home screen.
 */
export const ParentPortal: React.FC<ParentPortalProps> = ({ students, buses, notifications, onUpdateStatus, currentUser }) => {
  const [section, setSection] = useState<'children' | 'notifications'>('children');
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);

  const myChildren = students.filter((s) => s.parentId === currentUser?.id);
  const selectedChild = myChildren.find((c) => c.id === selectedChildId) ?? null;
  const selectedBus = selectedChild ? buses.find((b) => b.id === selectedChild.busId) : undefined;

  // Pre-arrival alert engine — behavior preserved exactly from the prior
  // implementation (date-scoped localStorage dedup so a real event fires at
  // most once per student per day), only its settings UI moved.
  const [isAutoNotifyEnabled, setIsAutoNotifyEnabled] = useState(true);
  const [leadTimeMinutes, setLeadTimeMinutes] = useState<number>(5);
  const [notificationChannel, setNotificationChannel] = useState<'in_app' | 'sms'>('in_app');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const todayKey = `masara_fired_alerts_${new Date().toISOString().slice(0, 10)}`;
  const [firedStudentAlerts, setFiredStudentAlerts] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(todayKey);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [activeToast, setActiveToast] = useState<{ studentName: string; busNumber: string; eta: number } | null>(null);

  useEffect(() => {
    if (!isAutoNotifyEnabled) return;
    for (const child of myChildren) {
      const bus = buses.find((b) => b.id === child.busId);
      if (!bus) continue;
      const currentEta = bus.nextStopEtaMins;
      const alertKey = `${child.id}-${bus.id}-${leadTimeMinutes}`;
      if (currentEta <= leadTimeMinutes && !firedStudentAlerts[alertKey]) {
        setFiredStudentAlerts((prev) => {
          const next = { ...prev, [alertKey]: true };
          try {
            localStorage.setItem(todayKey, JSON.stringify(next));
          } catch {
            // in-memory dedup for this session still works
          }
          return next;
        });
        fetch('/api/notifications/schedule-prearrival', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(currentUser?.sessionToken) },
          body: JSON.stringify({ studentId: child.id, busId: bus.id, minutesBefore: leadTimeMinutes })
        }).catch(console.error);
        playChimeSound();
        setActiveToast({ studentName: child.name, busNumber: bus.busNumber, eta: currentEta });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buses, myChildren.map((c) => c.id).join(','), leadTimeMinutes, isAutoNotifyEnabled]);

  if (students.length > 0 && myChildren.length === 0) {
    return (
      <EmptyState
        icon={<Users />}
        title="لا يوجد أبناء مرتبطون بحسابك"
        description="تقوم إدارة المدرسة بربط الطالب بحساب ولي الأمر الصحيح. تواصل مع المدرسة لإتمام الربط."
      />
    );
  }

  if (students.length === 0) {
    return (
      <div className="space-y-3">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {activeToast && (
        <div className="bg-warning-soft border border-warning-border rounded-2xl p-4 flex items-start gap-3 animate-fade-in">
          <div className="p-2 bg-amber-500 text-white rounded-xl shrink-0"><Timer className="w-4 h-4" /></div>
          <div className="flex-1 text-sm">
            <p className="font-bold text-amber-900">حافلة {activeToast.studentName} تبعد {activeToast.eta} دقائق</p>
            <p className="text-amber-800">استعد عند نقطة التجمع.</p>
          </div>
          <button onClick={() => setActiveToast(null)} className="text-amber-700 p-1"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="hidden sm:flex justify-start">
        <Tabs items={SECTIONS} activeId={section} onChange={(id) => setSection(id as typeof section)} />
      </div>

      {section === 'children' && (
        <div className="space-y-4">
          <div>
            <h1 className="text-xl font-bold text-text-primary">
              {greeting()}{currentUser?.name ? `، ${firstName(currentUser.name)}` : ''}
            </h1>
            <p className="text-sm text-text-secondary mt-0.5">
              {myChildren.filter((c) => c.status === 'absent').length > 0
                ? 'أحد أبنائك مسجل غياب اليوم'
                : 'كل أبنائك بخير — إليك آخر تحديث'}
            </p>
          </div>

          <div className="space-y-3">
            {myChildren.map((child) => {
              const bus = buses.find((b) => b.id === child.busId);
              const status = STATUS_META[child.status];
              return (
                <Card key={child.id} interactive padding="md" onClick={() => setSelectedChildId(child.id)} className="flex items-center gap-3.5">
                  <img src={child.avatar} alt={child.name} className="w-14 h-14 rounded-2xl object-cover border border-border-default shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-bold text-text-primary truncate">{child.name}</h3>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-text-secondary mt-1">
                      <span>{child.grade}</span>
                      {bus && (
                        <>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {bus.busNumber} — الوصول خلال {bus.nextStopEtaMins} د
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <ChevronLeft className="w-5 h-5 text-text-tertiary shrink-0" />
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {section === 'notifications' && (
        <div className="space-y-4">
          <h1 className="text-xl font-bold text-text-primary">الإشعارات</h1>

          <Card padding="none" className="overflow-hidden">
            <button onClick={() => setSettingsOpen((v) => !v)} className="w-full flex items-center justify-between gap-3 p-4 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary-soft text-primary rounded-xl"><Settings2 className="w-4 h-4" /></div>
                <div className="text-right">
                  <div className="font-bold text-sm text-text-primary">تنبيه اقتراب الحافلة</div>
                  <div className="text-xs text-text-secondary">{isAutoNotifyEnabled ? `مُفعّل — قبل ${leadTimeMinutes} دقائق` : 'معطّل'}</div>
                </div>
              </div>
              {settingsOpen ? <ChevronUp className="w-4 h-4 text-text-tertiary" /> : <ChevronDown className="w-4 h-4 text-text-tertiary" />}
            </button>

            {settingsOpen && (
              <div className="p-4 pt-0 space-y-3 border-t border-border-default animate-fade-in">
                <div className="flex items-center justify-between bg-surface-sunken rounded-xl p-3 mt-3">
                  <span className="text-sm font-bold text-text-primary">تفعيل التنبيه التلقائي</span>
                  <button
                    onClick={() => setIsAutoNotifyEnabled((v) => !v)}
                    className={`w-11 h-6 rounded-full relative transition-colors ${isAutoNotifyEnabled ? 'bg-primary' : 'bg-slate-300'}`}
                  >
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${isAutoNotifyEnabled ? 'right-0.5' : 'right-5'}`} />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {[3, 5, 10].map((value) => (
                    <button
                      key={value}
                      onClick={() => setLeadTimeMinutes(value)}
                      className={`py-2 rounded-lg border font-bold text-sm ${leadTimeMinutes === value ? 'bg-primary text-white border-primary-hover' : 'bg-surface-sunken text-text-secondary border-border-default'}`}
                    >
                      {value} د
                    </button>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  {[
                    { id: 'in_app' as const, label: 'داخل التطبيق', icon: Volume2 },
                    { id: 'sms' as const, label: 'رسالة SMS', icon: Smartphone }
                  ].map((ch) => {
                    const Icon = ch.icon;
                    const isSel = notificationChannel === ch.id;
                    return (
                      <button
                        key={ch.id}
                        onClick={() => setNotificationChannel(ch.id)}
                        className={`flex-1 py-2 rounded-lg border font-bold text-sm flex items-center justify-center gap-1.5 ${isSel ? 'bg-primary text-white border-primary-hover' : 'bg-surface-sunken text-text-secondary border-border-default'}`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {ch.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>

          {currentUser?.email && <NotificationsPanel userEmail={currentUser.email} />}

          {notifications.length === 0 ? (
            <EmptyState icon={<Bell />} title="لا توجد إشعارات" description="ستظهر هنا التنبيهات المتعلقة برحلة أبنائك فور توفرها." />
          ) : (
            <div className="space-y-2.5">
              {notifications.map((notif) => (
                <Card key={notif.id} padding="sm">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-bold text-sm text-text-primary">{notif.title}</p>
                    <span className="text-xs text-text-tertiary shrink-0">{notif.timestamp}</span>
                  </div>
                  <p className="text-sm text-text-secondary mt-1 leading-relaxed">{notif.message}</p>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      <MobileTabBar items={SECTIONS} activeId={section} onChange={(id) => setSection(id as typeof section)} />

      <ChildDetailSheet student={selectedChild} bus={selectedBus} currentUser={currentUser ?? null} onClose={() => setSelectedChildId(null)} onUpdateStatus={onUpdateStatus} />
    </div>
  );
};
