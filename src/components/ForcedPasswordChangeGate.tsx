import React, { useState } from 'react';
import { KeyRound, Eye, EyeOff, AlertCircle, ShieldCheck } from 'lucide-react';
import { AuthUser } from './AuthModal';
import { legacyAuthHeaders } from '../services/legacyAuthHeaders';

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
export const ForcedPasswordChangeGate: React.FC<ForcedPasswordChangeGateProps> = ({
  currentUser,
  onPasswordChangedRequireRelogin
}) => {
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
    <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-4 font-['Tajawal',sans-serif]">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="bg-gradient-to-l from-blue-700 to-indigo-700 px-6 py-5 text-white">
          <div className="flex items-center gap-2.5">
            <div className="bg-white/15 p-2 rounded-xl">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-sm">مطلوب تعيين كلمة مرور جديدة</h2>
              <p className="text-xs text-blue-100 mt-0.5">مرحباً {currentUser.name} — حسابك أُنشئ بكلمة مرور مؤقتة</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-xs text-slate-500 leading-relaxed bg-slate-50 border border-slate-200 rounded-xl p-3">
            لأسباب أمنية، يجب تعيين كلمة مرور خاصة بك قبل استخدام النظام. لن تتمكن من الوصول لأي جزء من التطبيق حتى تكمل هذه الخطوة.
          </p>

          {success ? (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-4 text-sm font-bold text-center">
              تم تغيير كلمة المرور بنجاح ✅
              <p className="text-xs font-medium text-emerald-700 mt-1">جارٍ تسجيل الخروج — الرجاء الدخول من جديد بكلمة المرور الجديدة.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3.5 text-xs font-medium">
              {error && (
                <div className="bg-rose-50 border border-rose-200 p-3 rounded-xl text-rose-800 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span className="font-medium">{error}</span>
                </div>
              )}

              <div>
                <label className="block text-slate-800 font-bold mb-1.5">كلمة المرور المؤقتة (المُرسلة من الإدارة):</label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
                  <input
                    type={showPasswords ? 'text' : 'password'}
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full pr-10 pl-3 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-600 focus:bg-white text-slate-900 text-xs font-sans transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-800 font-bold mb-1.5">كلمة المرور الجديدة (٨ أحرف على الأقل):</label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
                  <input
                    type={showPasswords ? 'text' : 'password'}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full pr-10 pl-10 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-600 focus:bg-white text-slate-900 text-xs font-sans transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswords(!showPasswords)}
                    className="absolute left-3.5 top-3.5 text-slate-400 hover:text-slate-600"
                  >
                    {showPasswords ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-slate-800 font-bold mb-1.5">تأكيد كلمة المرور الجديدة:</label>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-600 focus:bg-white text-slate-900 text-xs font-sans transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white font-bold py-3 rounded-xl text-sm transition-all"
              >
                {loading ? 'جارٍ الحفظ...' : 'تعيين كلمة المرور والمتابعة'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
