import React from 'react';
import { UserRole, SystemNotification } from '../types';
import { AuthUser } from './AuthModal';
import {
  Bus,
  ShieldCheck,
  Bell,
  Sparkles,
  Users,
  Navigation,
  Building2,
  BarChart3,
  CheckCircle2,
  Flame,
  Zap,
  FolderPlus,
  UserCheck,
  LogOut,
  RefreshCw,
  KeyRound,
  ArrowLeftRight,
  ShieldAlert
} from 'lucide-react';

interface HeaderProps {
  activeRole: UserRole;
  setActiveRole: (role: UserRole) => void;
  notifications: SystemNotification[];
  onOpenNotifications: () => void;
  onOpenAdvisor: () => void;
  onOpenDataManagement: () => void;
  onOpenApprovalCenter: () => void;
  currentUser: AuthUser | null;
  onOpenAuthModal: () => void;
  onLogout: () => void;
  isSyncing?: boolean;
  lastSyncTime?: string;
}

export const Header: React.FC<HeaderProps> = ({
  activeRole,
  setActiveRole,
  notifications,
  onOpenNotifications,
  onOpenAdvisor,
  onOpenDataManagement,
  onOpenApprovalCenter,
  currentUser,
  onOpenAuthModal,
  onLogout,
  isSyncing = false,
  lastSyncTime
}) => {
  // Only operational-approver roles see the Approval Center entry point
  // (spec Phase 2A §20 — parents/drivers must not approve AI recommendations).
  const canApprove = currentUser?.role === 'admin' || currentUser?.role === 'school';
  const unreadCount = notifications.filter((n) => !n.read).length;

  const roleButtons: { id: UserRole; label: string; icon: React.ReactNode; desc: string }[] = [
    {
      id: 'parent',
      label: 'تطبيق ولي الأمر',
      icon: <Users className="w-4 h-4" />,
      desc: 'متابعة الأبناء والإشعارات'
    },
    {
      id: 'driver',
      label: 'تطبيق السائق',
      icon: <Navigation className="w-4 h-4" />,
      desc: 'الملاحة وقوائم الطلاب'
    },
    {
      id: 'school',
      label: 'لوحة المدرسة',
      icon: <Building2 className="w-4 h-4" />,
      desc: 'رصد الوصول والحضور'
    },
    {
      id: 'admin',
      label: 'محرك مَسارَا (AI)',
      icon: <BarChart3 className="w-4 h-4" />,
      desc: 'المعمارية وإعادة التخطيط'
    }
  ];

  return (
    <header className="bg-white/95 border-b border-slate-200 backdrop-blur sticky top-0 z-40 text-slate-900">
      {/* Top Bar with AI Status & Sync Status */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2 flex flex-col sm:flex-row items-center justify-between gap-2.5 text-xs border-b border-slate-100 bg-slate-50/60">
        <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto justify-between sm:justify-start">
          {/* Live Sync Status Badge */}
          <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-800 px-2.5 py-1 rounded-full border border-emerald-200 font-bold text-[10px] sm:text-[11px] shadow-2xs">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <RefreshCw className={`w-3.5 h-3.5 text-emerald-600 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>متزامنة فورياً (Live 🟢)</span>
            {lastSyncTime && <span className="text-[9px] text-emerald-700 font-normal hidden xs:inline">({lastSyncTime})</span>}
          </div>

          <span className="text-slate-300 hidden md:inline">|</span>

          <div className="flex items-center gap-1.5 text-blue-900 font-semibold hidden lg:flex">
            <Sparkles className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
            <span>وكيل مَسارَا الذكي (MASARA OMAN AI) متصل وفعّال</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 w-full sm:w-auto justify-end overflow-x-auto pb-1 sm:pb-0">
          {/* Current Auth User Bar */}
          {currentUser ? (
            <div className="flex items-center gap-1.5 sm:gap-2 bg-indigo-50 border border-indigo-200/80 px-2.5 py-1 rounded-lg text-indigo-900 text-xs font-bold shrink-0">
              <UserCheck className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <span className="max-w-[100px] sm:max-w-[130px] truncate text-[11px] sm:text-xs">{currentUser.name}</span>
              <button
                onClick={onLogout}
                title="تسجيل الخروج"
                className="text-slate-400 hover:text-rose-600 transition-colors mr-0.5 p-0.5"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenAuthModal}
              className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1 rounded-lg transition-all text-xs font-bold shadow-sm shrink-0 min-h-[32px]"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>تسجيل الدخول</span>
            </button>
          )}

          {canApprove && (
            <button
              onClick={onOpenApprovalCenter}
              className="flex items-center gap-1 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 px-2.5 py-1 rounded-lg transition-all text-xs font-semibold shadow-2xs shrink-0 min-h-[32px]"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
              <span className="hidden xs:inline">مركز الموافقات</span>
              <span className="xs:hidden">الموافقات</span>
            </button>
          )}

          <button
            onClick={onOpenDataManagement}
            className="flex items-center gap-1 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 px-2.5 py-1 rounded-lg transition-all text-xs font-semibold shadow-2xs shrink-0 min-h-[32px]"
          >
            <FolderPlus className="w-3.5 h-3.5 text-blue-600" />
            <span className="hidden xs:inline">إدارة البيانات</span>
            <span className="xs:hidden">البيانات</span>
          </button>

          <button
            onClick={onOpenAdvisor}
            className="flex items-center gap-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80 px-2.5 py-1 rounded-lg transition-all text-xs font-semibold shadow-2xs shrink-0 min-h-[32px]"
          >
            <Zap className="w-3.5 h-3.5 text-amber-600" />
            <span className="hidden xs:inline">المساعد الذكي</span>
            <span className="xs:hidden">المساعد</span>
          </button>

          <button
            onClick={onOpenNotifications}
            className="relative flex items-center gap-1 bg-white hover:bg-slate-50 text-slate-700 px-2.5 py-1 rounded-lg border border-slate-200 transition-colors text-xs font-semibold shadow-2xs shrink-0 min-h-[32px]"
          >
            <Bell className="w-3.5 h-3.5 text-blue-600" />
            <span className="hidden xs:inline">الإشعارات</span>
            {unreadCount > 0 && (
              <span className="bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                {unreadCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Main Brand & Role Selector Bar */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Brand Logo & Slogan */}
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md border border-blue-500 shrink-0">
            <Bus className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 font-['Tajawal']">
                مَسارَا <span className="text-blue-600 text-base sm:text-lg font-bold tracking-wider">MASARA</span>
              </h1>
              <span className="bg-blue-50 text-blue-700 border border-blue-200 text-[9px] sm:text-[10px] font-bold px-2 py-0.5 rounded-md">
                OMAN AI
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-500 font-medium">
              تطبيقات النقل المدرسي الذكي مع مزامنة فورية للبيانات
            </p>
          </div>
        </div>

        {/* Active Application Display & Switch Button */}
        {(() => {
          const activeRoleItem = roleButtons.find((r) => r.id === activeRole) || roleButtons[0];
          return (
            <div className="flex items-center justify-between sm:justify-end gap-3 bg-slate-100/90 border border-slate-200/80 px-3.5 py-2 rounded-2xl w-full md:w-auto">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-blue-600 text-white rounded-xl shadow-xs shrink-0">
                  {activeRoleItem.icon}
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 font-bold leading-none mb-0.5">التطبيق المفتوح حالياً:</div>
                  <div className="text-xs sm:text-sm font-black text-slate-900 leading-tight flex items-center gap-1.5">
                    <span>{activeRoleItem.label}</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                  </div>
                </div>
              </div>

              <button
                onClick={onOpenAuthModal}
                className="flex items-center gap-1.5 bg-white hover:bg-blue-50 text-blue-700 border border-slate-200 hover:border-blue-300 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-2xs shrink-0"
              >
                <ArrowLeftRight className="w-3.5 h-3.5 text-blue-600" />
                <span>تبديل التطبيق</span>
              </button>
            </div>
          );
        })()}
      </div>

      {/* Live Operational Ticker */}
      <div className="bg-slate-50 border-t border-slate-200 py-1.5 px-4 sm:px-6 overflow-x-auto text-[11px] text-slate-600 flex items-center justify-between gap-6 whitespace-nowrap">
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-1.5 text-slate-800 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>الرحلات النشطة الآن: <strong className="text-emerald-700">2 رحلة</strong></span>
          </span>
          <span className="flex items-center gap-1.5 text-slate-800 font-medium">
            <Users className="w-3.5 h-3.5 text-amber-600" />
            <span>الطلاب المحولون اليوم: <strong className="text-amber-800">320 طالب</strong></span>
          </span>
          <span className="flex items-center gap-1.5 text-slate-800 font-medium">
            <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
            <span>مؤشر أمان القيادة: <strong className="text-blue-700">98.4%</strong></span>
          </span>
          <span className="flex items-center gap-1.5 text-slate-800 font-medium">
            <Flame className="w-3.5 h-3.5 text-teal-600" />
            <span>تأكيد المزامنة: <strong className="text-teal-700">تحديث تلقائي كل ثانيتين 🟢</strong></span>
          </span>
        </div>
        <div className="text-slate-500 font-mono text-[10px]">
          سلطنة عمان - محافظة مسقط (حي القرم / الخوض / العذيبة)
        </div>
      </div>
    </header>
  );
};
