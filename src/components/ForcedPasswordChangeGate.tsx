import React, { useState } from 'react';
import { KeyRound, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { AuthUser } from './AuthModal';
import { legacyAuthHeaders } from '../services/legacyAuthHeaders';
import { Button, Field, Input, Alert } from './ui';

interface ForcedPasswordChangeGateProps {
  currentUser: AuthUser;
  /** Called after a successful change — the backend revokes every session for this user (including the one making this request, the same established Phase 7H decision), so the only correct next step is a fresh login, never a silent continuation. */
  onPasswordChangedRequireRelogin: () => void;
}

// Phase 8B — blocks access to every portal for an employee still holding
// an admin-issued temporary credential. Rendered instead of the entire
// app (see App.tsx), not as a dismissible modal on top of it — there is
// no "skip for now" path, matching the backend's own enforcement intent
// even though the actual gate is a frontend concern (server.ts's other
// routes don't themselves check mustChangePassword — see the phase spec's
// own note on this being a deliberate, documented scope boundary).
export const ForcedPasswordChangeGate: React.FC<ForcedPasswordChangeGateProps> = ({ currentUser, onPasswordChangedRequireRelogin }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentPassword || !newPassword) {
      setError('يرجى تعبئة كلمة المرور المؤقتة وكلمة المرور الجديدة.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('كلمة المرور الجديدة وتأكيدها غير متطابقين.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(currentUser.sessionToken) },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json();
      if (data.success) {
        setSuccess(true);
        setTimeout(onPasswordChangedRequireRelogin, 2200);
      } else {
        setError(data.error || 'تعذّر تغيير كلمة المرور. يرجى التحقق من كلمة المرور المؤقتة.');
      }
    } catch {
      setError('حدث خطأ في الاتصال بالخادم. يرجى المحاولة مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center text-white mb-4">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h1 className="text-xl font-bold text-text-primary">تعيين كلمة مرور جديدة</h1>
          <p className="text-sm text-text-secondary mt-1">مرحباً {currentUser.name} — حسابك أُنشئ بكلمة مرور مؤقتة</p>
        </div>

        <div className="bg-surface border border-border-default rounded-2xl p-5 sm:p-6 space-y-4">
          <p className="text-xs text-text-secondary leading-relaxed bg-surface-sunken border border-border-default rounded-xl p-3">
            لأسباب أمنية، يجب تعيين كلمة مرور خاصة بك قبل استخدام النظام. لن تتمكن من الوصول لأي جزء من التطبيق حتى تكمل هذه الخطوة.
          </p>

          {success ? (
            <Alert tone="success" title="تم تغيير كلمة المرور بنجاح" description="جارٍ تسجيل الخروج — الرجاء الدخول من جديد بكلمة المرور الجديدة." />
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && <Alert tone="danger" title={error} />}

              <Field label="كلمة المرور المؤقتة (المُرسلة من الإدارة)" required>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-text-tertiary absolute right-3.5 top-1/2 -translate-y-1/2" />
                  <Input type={showPasswords ? 'text' : 'password'} required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} dir="ltr" className="pr-10 text-right" />
                </div>
              </Field>

              <Field label="كلمة المرور الجديدة (٨ أحرف على الأقل)" required>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-text-tertiary absolute right-3.5 top-1/2 -translate-y-1/2" />
                  <Input type={showPasswords ? 'text' : 'password'} required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} dir="ltr" className="pr-10 pl-10 text-right" />
                  <button type="button" onClick={() => setShowPasswords(!showPasswords)} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-tertiary">
                    {showPasswords ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </Field>

              <Field label="تأكيد كلمة المرور الجديدة" required>
                <Input type={showPasswords ? 'text' : 'password'} required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} dir="ltr" className="text-right" />
              </Field>

              <Button type="submit" variant="primary" fullWidth loading={loading}>
                تعيين كلمة المرور والمتابعة
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
