import React, { useState } from 'react';
import { UserRole, SystemNotification } from '../types';
import { AuthUser } from './AuthModal';
import { Bus, Bell, Zap } from 'lucide-react';
import { IconButton, Avatar } from './ui';
import { ProfileSheet } from './ProfileSheet';

interface HeaderProps {
  notifications: SystemNotification[];
  onOpenNotifications: () => void;
  onOpenAdvisor: () => void;
  currentUser: AuthUser | null;
  onLogout: () => void;
  isSyncing?: boolean;
}

// Phase 9B — the header is deliberately minimal: brand + two universal
// utilities (notifications, AI help) + account. Role-specific navigation
// (what an admin or school actually works with day to day) now lives
// inside each portal's own section navigation, matching that role's own
// mental model — a parent should never see "إدارة البيانات" in the same
// bar as "متابعة أبنائي" just because both happen to be reachable by the
// same logged-in app shell.
const ROLE_LABELS: Record<UserRole, string> = {
  parent: 'ولي أمر',
  driver: 'سائق',
  school: 'إدارة مدرسة',
  admin: 'مشرف عام'
};

export const Header: React.FC<HeaderProps> = ({ notifications, onOpenNotifications, onOpenAdvisor, currentUser, onLogout, isSyncing = false }) => {
  const [profileOpen, setProfileOpen] = useState(false);
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <>
      <header className="bg-white border-b border-border-default sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center text-white shrink-0">
              <Bus className="w-4.5 h-4.5" />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-base font-black text-text-primary leading-none">مَسارَا</h1>
              <div className="flex items-center gap-1 text-xs text-text-tertiary mt-0.5">
                <span className={`w-1.5 h-1.5 rounded-full ${isSyncing ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`} />
                <span>{isSyncing ? 'جاري التحديث' : 'متصل'}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <IconButton label="المساعد الذكي" onClick={onOpenAdvisor}>
              <Zap className="text-amber-500" />
            </IconButton>

            <IconButton label="الإشعارات" onClick={onOpenNotifications} className="relative">
              <Bell className="text-primary" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -left-1 bg-danger text-white text-[10px] font-bold min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center border-2 border-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </IconButton>

            {currentUser && (
              <button onClick={() => setProfileOpen(true)} className="flex items-center gap-2 pr-1 pl-2.5 py-1 rounded-xl hover:bg-slate-50 transition-colors">
                <Avatar src={currentUser.avatar} name={currentUser.name} size="sm" />
                <div className="hidden sm:block text-right leading-tight">
                  <div className="text-xs font-bold text-text-primary max-w-[110px] truncate">{currentUser.name}</div>
                  <div className="text-[11px] text-text-tertiary">{ROLE_LABELS[currentUser.role]}</div>
                </div>
              </button>
            )}
          </div>
        </div>
      </header>

      {currentUser && <ProfileSheet isOpen={profileOpen} onClose={() => setProfileOpen(false)} currentUser={currentUser} onLogout={onLogout} onOpenAdvisor={onOpenAdvisor} />}
    </>
  );
};
