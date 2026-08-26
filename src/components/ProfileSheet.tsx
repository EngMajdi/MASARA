import React, { useState } from 'react';
import { AuthUser } from './AuthModal';
import { UserRole } from '../types';
import { Sheet, Avatar, Button, Field, Input, Alert } from './ui';
import { LogOut, Lock, Bell, Globe, HelpCircle, Eye, EyeOff } from 'lucide-react';
import { legacyAuthHeaders } from '../services/legacyAuthHeaders';

interface ProfileSheetProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AuthUser;
  onLogout: () => void;
  onOpenAdvisor: () => void;
}

const ROLE_LABELS: Record<UserRole, string> = {
  parent: 'ولي أمر',
  driver: 'سائق',
  school: 'إدارة مدرسة',
  admin: 'مشرف عام'
};

/** Account, security, notifications, and help — the one settings surface every role reaches from the header avatar. */
export const ProfileSheet: React.FC<ProfileSheetProps> = ({ isOpen, onClose, currentUser, onLogout, onOpenAdvisor }) => {
  const [changingPassword, setChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [notifyEnabled, setNotifyEnabled] = useState(() => localStorage.getItem('masara_notify_pref') !== 'off');

  const toggleNotify = () => {
    const next = !notifyEnabled;
    setNotifyEnabled(next);
    localStorage.setItem('masara_notify_pref', next ? 'on' : 'off');
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    if (!currentPassword || !newPassword) {
      setPwError('يرجى تعبئة كلمة المرور الحالية والجديدة');
      return;
    }
    setPwLoading(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(currentUser.sessionToken) },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json();
      if (data.success) {
        setPwSuccess(true);
        setCurrentPassword('');
        setNewPassword('');
        setTimeout(() => {
          setChangingPassword(false);
          setPwSuccess(false);
        }, 1800);
      } else {
        setPwError(data.error || 'تعذّر تغيير كلمة المرور');
      }
    } catch {
      setPwError('تعذّر الاتصال بالخادم');
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <Sheet isOpen={isOpen} onClose={onClose} title="حسابي">
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Avatar src={currentUser.avatar} name={currentUser.name} size="lg" />
          <div className="min-w-0">
            <div className="font-bold text-text-primary truncate">{currentUser.name}</div>
            <div className="text-sm text-text-secondary truncate" dir="ltr">{currentUser.email}</div>
            <div className="text-xs text-primary font-bold mt-0.5">{ROLE_LABELS[currentUser.role]}</div>
          </div>
        </div>

        <div className="border-t border-border-default pt-4 space-y-1">
          <button
            onClick={() => setChangingPassword((v) => !v)}
            className="w-full flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-slate-50 transition-colors text-right"
          >
            <Lock className="w-4 h-4 text-text-secondary shrink-0" />
            <span className="flex-1 text-sm font-bold text-text-primary">تغيير كلمة المرور</span>
          </button>

          {changingPassword && (
            <form onSubmit={handleChangePassword} className="px-2 pb-3 space-y-3 animate-fade-in">
              {pwError && <Alert tone="danger" title={pwError} />}
              {pwSuccess && <Alert tone="success" title="تم تغيير كلمة المرور بنجاح" />}
              <Field label="كلمة المرور الحالية">
                <Input type={showPw ? 'text' : 'password'} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} dir="ltr" />
              </Field>
              <Field label="كلمة المرور الجديدة">
                <div className="relative">
                  <Input type={showPw ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} dir="ltr" className="pl-10" />
                  <button type="button" onClick={() => setShowPw(!showPw)} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-tertiary">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </Field>
              <Button type="submit" size="sm" loading={pwLoading} fullWidth>
                حفظ
              </Button>
            </form>
          )}

          <button onClick={toggleNotify} className="w-full flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-slate-50 transition-colors text-right">
            <Bell className="w-4 h-4 text-text-secondary shrink-0" />
            <span className="flex-1 text-sm font-bold text-text-primary">تنبيهات الصوت داخل التطبيق</span>
            <span className={`w-11 h-6 rounded-full relative transition-colors ${notifyEnabled ? 'bg-primary' : 'bg-slate-300'}`}>
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${notifyEnabled ? 'right-0.5' : 'right-5'}`} />
            </span>
          </button>

          <div className="w-full flex items-center gap-3 px-2 py-3">
            <Globe className="w-4 h-4 text-text-secondary shrink-0" />
            <span className="flex-1 text-sm font-bold text-text-primary">اللغة</span>
            <span className="text-sm text-text-secondary">العربية</span>
          </div>

          <button
            onClick={() => {
              onClose();
              onOpenAdvisor();
            }}
            className="w-full flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-slate-50 transition-colors text-right"
          >
            <HelpCircle className="w-4 h-4 text-text-secondary shrink-0" />
            <span className="flex-1 text-sm font-bold text-text-primary">المساعدة</span>
          </button>
        </div>

        <div className="border-t border-border-default pt-4">
          <button onClick={onLogout} className="w-full flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-danger-soft transition-colors text-right text-danger">
            <LogOut className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-sm font-bold">تسجيل الخروج</span>
          </button>
        </div>
      </div>
    </Sheet>
  );
};
