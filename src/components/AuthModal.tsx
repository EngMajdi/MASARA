import React, { useState } from 'react';
import { UserRole } from '../types';
import { Bus, Mail, Lock, Eye, EyeOff, AlertCircle, ShieldCheck, User } from 'lucide-react';
import { Button, Input, Field } from './ui';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
  /** Phase 7A — the legacy session token issued at login, required by the newly-protected legacy surface (server.ts's /api/students, /api/buses, /api/routes, /api/ai/*, and the governance reads in agentRoutes.ts). Absent only in the offline-fallback path below, where no real server session was ever issued. */
  sessionToken?: string;
  /** Phase 8B — true only for an admin-issued temporary credential the employee hasn't replaced yet. App.tsx must block access to every portal until a successful change-password call clears it. */
  mustChangePassword?: boolean;
}

interface AuthModalProps {
  onLoginSuccess: (user: AuthUser) => void;
}

// Phase 9B — a real user never "picks which app" to enter; this is a plain
// sign-in screen. Demo shortcuts are pilot-only scaffolding (no real
// self-service signup exists yet for staff roles) and are kept minimal and
// visually secondary — never the first thing a real customer would see.
const DEMO_ACCOUNTS: { id: UserRole; label: string; email: string }[] = [
  { id: 'parent', label: 'ولي أمر', email: 'parent@masara.om' },
  { id: 'driver', label: 'سائق', email: 'driver1@masara.om' },
  { id: 'school', label: 'إدارة مدرسة', email: 'school@masara.om' },
  { id: 'admin', label: 'مشرف عام', email: 'admin@masara.om' }
];

export const AuthModal: React.FC<AuthModalProps> = ({ onLoginSuccess }) => {
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submitLogin = async (loginEmail: string, loginPass: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPass })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        onLoginSuccess({ ...data.user, sessionToken: data.sessionToken });
      } else {
        setError(data.error || 'فشل تسجيل الدخول. يرجى التحقق من البريد الإلكتروني وكلمة المرور.');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('تعذّر الاتصال بالخادم. يرجى المحاولة مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = (account: (typeof DEMO_ACCOUNTS)[number]) => {
    setEmail(account.email);
    setPassword('password123');
    setError(null);
    submitLogin(account.email, 'password123');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('يرجى كتابة البريد الإلكتروني وكلمة المرور');
      return;
    }

    if (activeTab === 'login') {
      submitLogin(email, password);
    } else {
      if (!name) {
        setError('يرجى كتابة الاسم الكامل للحساب الجديد');
        return;
      }
      setLoading(true);
      setError(null);
      fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password })
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.success) {
            onLoginSuccess({ ...data.user, sessionToken: data.sessionToken });
          } else {
            setError(data.error || 'فشل إنشاء الحساب الجديد');
          }
        })
        .catch(() => setError('تعذّر الاتصال بالخادم. يرجى المحاولة مرة أخرى.'))
        .finally(() => setLoading(false));
    }
  };

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center text-white mb-4">
            <Bus className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-black text-text-primary">مَسارَا MASARA</h1>
          <p className="text-sm text-text-secondary mt-1">النقل المدرسي الآمن — سلطنة عمان</p>
        </div>

        <div className="bg-surface border border-border-default rounded-2xl p-5 sm:p-6 space-y-5">
          <div className="flex bg-slate-100 p-1 rounded-xl text-sm font-bold">
            <button
              type="button"
              onClick={() => {
                setActiveTab('login');
                setError(null);
              }}
              className={`flex-1 py-2 rounded-lg transition-all ${activeTab === 'login' ? 'bg-white text-text-primary shadow-sm' : 'text-text-secondary'}`}
            >
              تسجيل الدخول
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('register');
                setError(null);
              }}
              className={`flex-1 py-2 rounded-lg transition-all ${activeTab === 'register' ? 'bg-white text-text-primary shadow-sm' : 'text-text-secondary'}`}
            >
              حساب ولي أمر جديد
            </button>
          </div>

          {error && (
            <div className="bg-danger-soft border border-danger-border p-3 rounded-xl text-rose-800 text-sm flex items-center gap-2.5 animate-shake">
              <AlertCircle className="w-4 h-4 text-danger shrink-0" />
              <span className="font-medium">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {activeTab === 'register' && (
              <Field label="الاسم الكامل" required>
                <div className="relative">
                  <User className="w-4 h-4 text-text-tertiary absolute right-3.5 top-1/2 -translate-y-1/2" />
                  <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: أحمد بن سيف البوسعيدي" className="pr-10" />
                </div>
              </Field>
            )}

            <Field label="البريد الإلكتروني" required>
              <div className="relative">
                <Mail className="w-4 h-4 text-text-tertiary absolute right-3.5 top-1/2 -translate-y-1/2" />
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" dir="ltr" className="pr-10 text-right" />
              </div>
            </Field>

            <Field label="كلمة المرور" required>
              <div className="relative">
                <Lock className="w-4 h-4 text-text-tertiary absolute right-3.5 top-1/2 -translate-y-1/2" />
                <Input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  dir="ltr"
                  className="pr-10 pl-10 text-right"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-tertiary">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </Field>

            {activeTab === 'register' && (
              <p className="text-xs text-text-secondary leading-relaxed">
                الحسابات الجديدة تُنشأ كحساب ولي أمر. حسابات السائق والمدرسة والمشرف تُصدرها إدارة المدرسة.
              </p>
            )}

            <Button type="submit" variant="primary" fullWidth loading={loading}>
              {activeTab === 'login' ? 'تسجيل الدخول' : 'إنشاء الحساب'}
            </Button>
          </form>

          <div className="flex items-center gap-2 text-emerald-700 bg-success-soft border border-success-border rounded-xl px-3 py-2 text-xs font-medium">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>بياناتك محمية ولا تُشارك إلا مع إدارة مدرستك</span>
          </div>
        </div>

        {/* Demo/pilot shortcuts */}
        <div className="mt-5">
          <p className="text-xs text-text-tertiary font-bold mb-2 text-center">حسابات تجريبية للاطلاع السريع</p>
          <div className="grid grid-cols-4 gap-1.5">
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.id}
                type="button"
                onClick={() => handleDemoLogin(account)}
                className="py-1.5 px-1 rounded-lg text-xs font-bold border border-border-default text-text-secondary hover:border-primary-border hover:text-primary hover:bg-primary-soft transition-colors"
              >
                {account.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
