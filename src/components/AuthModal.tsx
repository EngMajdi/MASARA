import React, { useState } from 'react';
import { UserRole } from '../types';
import {
  Bus,
  User,
  Lock,
  Mail,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Sparkles,
  School,
  Heart,
  X,
  Eye,
  EyeOff,
  Zap,
  MapPin,
  Check,
  Navigation,
  KeyRound,
  ChevronLeft
} from 'lucide-react';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
  /** Phase 7A — the legacy session token issued at login, required by the newly-protected legacy surface (server.ts's /api/students, /api/buses, /api/routes, /api/ai/*, and the governance reads in agentRoutes.ts). Absent only in the offline-fallback path below, where no real server session was ever issued. */
  sessionToken?: string;
}

interface AuthModalProps {
  isOpen: boolean;
  onClose?: () => void;
  onLoginSuccess: (user: AuthUser) => void;
  targetRole?: UserRole;
  isCancelable?: boolean;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onLoginSuccess,
  targetRole = 'parent',
  isCancelable = false
}) => {
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
  const [role, setRole] = useState<UserRole>(targetRole);

  const [email, setEmail] = useState('parent@masara.om');
  const [password, setPassword] = useState('password123');
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const roleOptions: {
    id: UserRole;
    title: string;
    subTitle: string;
    demoEmail: string;
    demoName: string;
    icon: React.ReactNode;
    accentColor: string;
    borderColor: string;
    bgColor: string;
    selectedRing: string;
    badgeText: string;
  }[] = [
    {
      id: 'parent',
      title: 'تطبيق ولي الأمر',
      subTitle: 'تتبع الأبناء وحافلة المدرسة لحظياً',
      demoEmail: 'parent@masara.om',
      demoName: 'أحمد بن سيف البوسعيدي',
      icon: <Heart className="w-5 h-5 text-blue-600" />,
      accentColor: 'text-blue-700',
      borderColor: 'border-blue-200',
      bgColor: 'bg-blue-50/80',
      selectedRing: 'bg-blue-50/90 border-blue-600 shadow-md ring-2 ring-blue-500/20',
      badgeText: 'متابعة لحظية'
    },
    {
      id: 'driver',
      title: 'تطبيق السائق',
      subTitle: 'إدارة المسار اليومي وتفقد الطلاب',
      demoEmail: 'driver1@masara.om',
      demoName: 'الكابتن سعيد بن حمد البوسعيدي',
      icon: <Bus className="w-5 h-5 text-amber-600" />,
      accentColor: 'text-amber-700',
      borderColor: 'border-amber-200',
      bgColor: 'bg-amber-50/80',
      selectedRing: 'bg-amber-50/90 border-amber-500 shadow-md ring-2 ring-amber-500/20',
      badgeText: 'المسارات والملاحة'
    },
    {
      id: 'school',
      title: 'إدارة المدرسة',
      subTitle: 'لوحة تحكم الأسطول والسائقين',
      demoEmail: 'school@masara.om',
      demoName: 'مدرسة المسار الدولية - مسقط',
      icon: <School className="w-5 h-5 text-emerald-600" />,
      accentColor: 'text-emerald-700',
      borderColor: 'border-emerald-200',
      bgColor: 'bg-emerald-50/80',
      selectedRing: 'bg-emerald-50/90 border-emerald-500 shadow-md ring-2 ring-emerald-500/20',
      badgeText: 'الحوكمة والأمان'
    },
    {
      id: 'admin',
      title: 'الذكاء الاصطناعي',
      subTitle: 'المشرف العام وتخطيط المسارات',
      demoEmail: 'admin@masara.om',
      demoName: 'مركز مسارَا الذكي - مسقط',
      icon: <ShieldCheck className="w-5 h-5 text-purple-600" />,
      accentColor: 'text-purple-700',
      borderColor: 'border-purple-200',
      bgColor: 'bg-purple-50/80',
      selectedRing: 'bg-purple-50/90 border-purple-500 shadow-md ring-2 ring-purple-500/20',
      badgeText: 'Gemini 2.5 AI'
    }
  ];

  const handleSelectRole = (selectedRole: UserRole) => {
    setRole(selectedRole);
    const matched = roleOptions.find((r) => r.id === selectedRole);
    if (matched) {
      setEmail(matched.demoEmail);
      setPassword('password123');
    }
    setError(null);
  };

  const handleQuickDemoLogin = (roleType: UserRole) => {
    const matched = roleOptions.find((r) => r.id === roleType);
    if (matched) {
      setRole(roleType);
      setEmail(matched.demoEmail);
      setPassword('password123');
      submitLogin(matched.demoEmail, 'password123', roleType);
    }
  };

  const submitLogin = async (loginEmail: string, loginPass: string, loginRole: UserRole) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPass, role: loginRole })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        onLoginSuccess({ ...data.user, sessionToken: data.sessionToken });
      } else {
        setError(data.error || 'فشل تسجيل الدخول. يرجى التحقق من البريد وكلمة المرور.');
      }
    } catch (err) {
      console.error('Login error:', err);
      const matchedRole = roleOptions.find((r) => r.id === loginRole);
      const fallbackUser: AuthUser = {
        id: `usr-${Date.now()}`,
        name: matchedRole ? matchedRole.demoName : 'مستخدم مسارَا',
        email: loginEmail,
        role: loginRole,
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200'
      };
      onLoginSuccess(fallbackUser);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('يرجى كتابة البريد الإلكتروني وكلمة المرور');
      return;
    }

    if (activeTab === 'login') {
      submitLogin(email, password, role);
    } else {
      if (!name) {
        setError('يرجى كتابة الاسم الكامل للحساب الجديد');
        return;
      }
      setLoading(true);
      fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, role })
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.success) {
            onLoginSuccess({ ...data.user, sessionToken: data.sessionToken });
          } else {
            setError(data.error || 'فشل إنشاء الحساب الجديد');
          }
        })
        .catch(() => {
          const newUser: AuthUser = {
            id: `usr-${Date.now()}`,
            name,
            email,
            role
          };
          onLoginSuccess(newUser);
        })
        .finally(() => setLoading(false));
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto font-['Tajawal',sans-serif]">
      {/* Background ambient lighting */}
      <div className="fixed inset-0 pointer-events-none opacity-25 bg-[radial-gradient(circle_at_50%_15%,#2563eb,transparent_55%)]"></div>

      <div className="bg-white border border-slate-200/90 rounded-3xl w-full max-w-3xl shadow-2xl overflow-hidden animate-fade-in text-slate-900 my-auto relative z-10 max-h-[96vh] flex flex-col">
        {/* Top Branding Panel */}
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 p-6 sm:p-8 text-white relative shrink-0 border-b border-slate-800">
          {isCancelable && onClose && (
            <button
              onClick={onClose}
              className="absolute top-5 left-5 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all border border-white/10"
              title="إغلاق النافذة"
            >
              <X className="w-5 h-5" />
            </button>
          )}

          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 text-center sm:text-right">
            <div className="p-3.5 bg-blue-600/30 rounded-2xl border border-blue-400/30 backdrop-blur-md shadow-inner shrink-0">
              <Bus className="w-10 h-10 text-blue-400 animate-pulse" />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                <h1 className="text-2xl sm:text-3xl font-black tracking-tight font-['Tajawal']">
                  مَسارَا <span className="text-blue-400 text-lg font-bold">MASARA OMAN</span>
                </h1>
                <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-[10px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                  نظام النقل المدرسي الذكي
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-300 font-medium">
                بوابة الدخول الموحدة لتطبيقات النقل المدرسي والتتبع اللحظي - سلطنة عمان
              </p>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-8 overflow-y-auto space-y-6 flex-1 bg-slate-50/50">
          {/* Step 1: Select Application Role */}
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-black text-xs flex items-center justify-center">
                  1
                </div>
                <h2 className="text-xs sm:text-sm font-black text-slate-900">
                  اختر التطبيق المراد الدخول إليه:
                </h2>
              </div>
              <span className="text-[11px] text-slate-500 font-medium">حدد التطبيق للانتقال المباشر</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {roleOptions.map((item) => {
                const isSelected = role === item.id;
                return (
                  <div
                    key={item.id}
                    onClick={() => handleSelectRole(item.id)}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between relative group ${
                      isSelected
                        ? item.selectedRing
                        : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-2xs'
                    }`}
                  >
                    {isSelected && (
                      <div className="absolute top-3 left-3 bg-blue-600 text-white p-0.5 rounded-full shadow-xs">
                        <Check className="w-3.5 h-3.5" />
                      </div>
                    )}

                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="p-1.5 rounded-xl bg-slate-50 border border-slate-100 shrink-0">
                          {item.icon}
                        </div>
                        <div>
                          <div className="font-bold text-xs text-slate-900 leading-tight">
                            {item.title}
                          </div>
                          <span className="text-[9px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded mt-0.5 inline-block">
                            {item.badgeText}
                          </span>
                        </div>
                      </div>

                      <p className="text-[10px] text-slate-500 font-medium leading-relaxed mt-1">
                        {item.subTitle}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleQuickDemoLogin(item.id);
                      }}
                      className="mt-3 py-1.5 px-2 bg-gradient-to-r from-blue-50 to-indigo-50 hover:from-blue-100 hover:to-indigo-100 text-blue-800 border border-blue-200/80 rounded-xl text-[11px] font-bold text-center transition-all shadow-2xs flex items-center justify-center gap-1.5 group-hover:border-blue-300"
                    >
                      <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span>دخول تجريبي بضغطة واحدة</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Step 2: Login or Register Credentials Form */}
          <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-black text-xs flex items-center justify-center">
                  2
                </div>
                <h2 className="text-xs sm:text-sm font-black text-slate-900">
                  بيانات البريد الإلكتروني وكلمة المرور:
                </h2>
              </div>

              {/* Login / Register Tab Toggle */}
              <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('login');
                    setError(null);
                  }}
                  className={`px-3 py-1 rounded-lg transition-all ${
                    activeTab === 'login'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  دخول
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('register');
                    setError(null);
                  }}
                  className={`px-3 py-1 rounded-lg transition-all ${
                    activeTab === 'register'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  حساب جديد
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-200 p-3.5 rounded-xl text-rose-800 text-xs flex items-center gap-2.5 animate-shake">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span className="font-medium">{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4 text-xs font-medium">
              {activeTab === 'register' && (
                <div>
                  <label className="block text-slate-800 font-bold mb-1.5">الاسم الكامل:</label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="مثال: أحمد بن سيف البوسعيدي"
                      className="w-full pr-10 pl-3 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-600 focus:bg-white text-slate-900 text-xs transition-all"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-800 font-bold mb-1.5">البريد الإلكتروني:</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="parent@masara.om"
                      className="w-full pr-10 pl-3 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-600 focus:bg-white text-slate-900 text-xs dir-ltr text-right transition-all font-sans"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-800 font-bold mb-1.5">كلمة المرور:</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pr-10 pl-10 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-600 focus:bg-white text-slate-900 text-xs transition-all font-sans"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute left-3.5 top-3.5 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Instant Autofill Chips */}
              <div className="pt-1 flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-slate-500 font-bold">تعبئة تلقائية للحسابات التجريبية:</span>
                {roleOptions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectRole(item.id)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors flex items-center gap-1 ${
                      role === item.id
                        ? 'bg-blue-600 text-white border-blue-700'
                        : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                    }`}
                  >
                    <span>{item.title}</span>
                  </button>
                ))}
              </div>

              <div className="pt-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-800 hover:from-blue-800 hover:to-indigo-800 text-white font-bold text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2 transform active:scale-[0.99]"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      <span>جاري تسجيل الدخول والمزامنة...</span>
                    </span>
                  ) : (
                    <>
                      <span>{activeTab === 'login' ? 'تأكيد الدخول إلى المنظومة' : 'إنشاء الحساب والدخول الفوري'}</span>
                      <ArrowRight className="w-4 h-4 rotate-180" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* Footer Features Banner */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-slate-600 font-medium shadow-2xs">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>مزامنة فورية حية بين مسقط وكافة محافظات سلطنة عمان</span>
            </div>
            <div className="flex items-center gap-3 text-slate-500 font-semibold">
              <span className="flex items-center gap-1">
                <Navigation className="w-3.5 h-3.5 text-blue-500" />
                تتبع GPS
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <KeyRound className="w-3.5 h-3.5 text-amber-500" />
                حساب موحد
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
