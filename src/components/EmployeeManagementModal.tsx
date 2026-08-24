import React, { useState, useEffect } from 'react';
import {
  X,
  UserPlus,
  Users,
  ShieldCheck,
  ShieldOff,
  KeyRound,
  LogOut,
  Copy,
  Check,
  AlertCircle,
  Plus
} from 'lucide-react';
import { AuthUser } from './AuthModal';
import { legacyAuthHeaders } from '../services/legacyAuthHeaders';

interface Employee {
  id: string;
  name: string;
  email: string;
  role: 'driver' | 'school' | 'admin';
  status: 'active' | 'disabled';
  mustChangePassword: boolean;
  createdAt: string;
}

interface EmployeeManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AuthUser | null;
}

const ROLE_LABELS: Record<Employee['role'], string> = {
  driver: 'سائق',
  school: 'مدرسة',
  admin: 'مشرف عام'
};

// Phase 8B — admin-only employee lifecycle management. No email dependency
// anywhere here: every temporary credential is shown exactly once, in this
// UI, immediately after the create/reset call succeeds — the admin is
// responsible for relaying it to the employee out-of-band.
export const EmployeeManagementModal: React.FC<EmployeeManagementModalProps> = ({ isOpen, onClose, currentUser }) => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Employee['role']>('driver');

  const [revealedCredential, setRevealedCredential] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const headers = { 'Content-Type': 'application/json', ...legacyAuthHeaders(currentUser?.sessionToken) };

  const loadEmployees = () => {
    if (!currentUser?.sessionToken) return;
    setLoading(true);
    fetch('/api/admin/employees', { headers: legacyAuthHeaders(currentUser.sessionToken) })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setEmployees(data.employees);
        else setError(data.error || 'تعذّر تحميل قائمة الموظفين');
      })
      .catch(() => setError('حدث خطأ في الاتصال بالخادم'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (isOpen) loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentUser?.sessionToken]);

  if (!isOpen) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim()) {
      setError('يرجى تعبئة الاسم والبريد الإلكتروني.');
      return;
    }
    try {
      const res = await fetch('/api/admin/employees', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: name.trim(), email: email.trim(), role })
      });
      const data = await res.json();
      if (data.success) {
        setRevealedCredential({ email: data.employee.email, password: data.temporaryPassword });
        setName('');
        setEmail('');
        loadEmployees();
      } else {
        setError(data.error || 'تعذّر إنشاء الحساب.');
      }
    } catch {
      setError('حدث خطأ في الاتصال بالخادم.');
    }
  };

  const handleToggleStatus = async (emp: Employee) => {
    setError(null);
    const action = emp.status === 'active' ? 'deactivate' : 'activate';
    try {
      const res = await fetch(`/api/admin/employees/${emp.id}/${action}`, { method: 'PATCH', headers });
      const data = await res.json();
      if (data.success) loadEmployees();
      else setError(data.error || 'تعذّر تنفيذ الإجراء.');
    } catch {
      setError('حدث خطأ في الاتصال بالخادم.');
    }
  };

  const handleResetCredential = async (emp: Employee) => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/employees/${emp.id}/reset-credential`, { method: 'POST', headers });
      const data = await res.json();
      if (data.success) {
        setRevealedCredential({ email: emp.email, password: data.temporaryPassword });
        loadEmployees();
      } else {
        setError(data.error || 'تعذّر إعادة تعيين بيانات الدخول.');
      }
    } catch {
      setError('حدث خطأ في الاتصال بالخادم.');
    }
  };

  const handleRevokeSessions = async (emp: Employee) => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/employees/${emp.id}/revoke-sessions`, { method: 'POST', headers });
      const data = await res.json();
      if (!data.success) setError(data.error || 'تعذّر تسجيل الخروج من كل الأجهزة.');
    } catch {
      setError('حدث خطأ في الاتصال بالخادم.');
    }
  };

  const copyToClipboard = () => {
    if (!revealedCredential) return;
    navigator.clipboard?.writeText(revealedCredential.password).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto font-['Tajawal',sans-serif]">
      <div className="bg-white border border-slate-200/90 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden relative text-slate-900 my-auto max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="bg-slate-950 p-4 sm:p-5 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-600/30 text-indigo-400 rounded-2xl border border-indigo-400/30 shrink-0">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black tracking-tight text-white">إدارة حسابات الموظفين</h3>
              <p className="text-[11px] sm:text-xs text-slate-400 font-medium">
                إنشاء وتفعيل وتعطيل حسابات السائقين وموظفي المدرسة — بدون بريد إلكتروني
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* One-time credential reveal */}
        {revealedCredential && (
          <div className="bg-amber-50 border-b border-amber-200 p-4 space-y-2">
            <div className="flex items-center gap-2 text-amber-900 font-bold text-xs">
              <KeyRound className="w-4 h-4" />
              <span>كلمة المرور المؤقتة — تُعرض مرة واحدة فقط ولن تظهر مجدداً</span>
            </div>
            <p className="text-[11px] text-amber-800">
              يرجى نسخ هذه البيانات ومشاركتها مع الموظف مباشرة (شخصياً أو هاتفياً) — لا يوجد مزود بريد إلكتروني مُفعّل في هذه البيئة.
            </p>
            <div className="bg-white border border-amber-300 rounded-xl p-3 flex items-center justify-between gap-3 font-sans" dir="ltr">
              <div className="text-xs">
                <div className="text-slate-500">{revealedCredential.email}</div>
                <div className="font-bold text-slate-900 text-sm">{revealedCredential.password}</div>
              </div>
              <button
                onClick={copyToClipboard}
                className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'تم النسخ' : 'نسخ'}</span>
              </button>
            </div>
            <button
              onClick={() => setRevealedCredential(null)}
              className="text-[11px] text-amber-700 font-bold underline"
            >
              فهمت، إخفاء هذا التنبيه
            </button>
          </div>
        )}

        {error && (
          <div className="bg-rose-50 border-b border-rose-200 px-4 py-2.5 text-xs text-rose-800 font-bold flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-5 bg-slate-50/50">
          {/* Create employee form */}
          <form onSubmit={handleCreate} className="bg-white border border-slate-200/90 p-4 sm:p-5 rounded-2xl shadow-2xs space-y-4">
            <h4 className="font-bold text-xs sm:text-sm text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2.5">
              <UserPlus className="w-4 h-4 text-blue-600" />
              <span>إضافة موظف جديد (سائق / مدرسة / مشرف عام)</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">الاسم الكامل:</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 focus:outline-none focus:border-blue-600 focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-slate-700 font-bold mb-1">البريد الإلكتروني (للدخول):</label>
                <input
                  type="email"
                  required
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 focus:outline-none focus:border-blue-600 focus:bg-white font-sans text-right"
                />
              </div>
              <div>
                <label className="block text-slate-700 font-bold mb-1">الدور الوظيفي:</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as Employee['role'])}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 focus:outline-none focus:border-blue-600 focus:bg-white"
                >
                  <option value="driver">سائق</option>
                  <option value="school">مدرسة</option>
                  <option value="admin">مشرف عام</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-5 py-2.5 rounded-xl text-xs flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>إنشاء الحساب وتوليد كلمة مرور مؤقتة</span>
              </button>
            </div>
          </form>

          {/* Employee list */}
          <div className="bg-white border border-slate-200/90 p-4 rounded-2xl shadow-2xs space-y-3">
            <h4 className="font-bold text-xs text-slate-800">الموظفون الحاليون ({employees.length}):</h4>
            {loading ? (
              <div className="text-center py-6 text-slate-400 text-xs">جارٍ التحميل...</div>
            ) : employees.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-xs">لا يوجد موظفون بعد</div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {employees.map((emp) => (
                  <div key={emp.id} className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-2">
                    <div className="flex items-center justify-between flex-wrap gap-1.5">
                      <div>
                        <span className="font-bold text-slate-900">{emp.name}</span>
                        <span className="text-slate-400 mx-1.5">•</span>
                        <span className="text-slate-500 font-sans" dir="ltr">{emp.email}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="bg-slate-200 text-slate-700 text-[10px] font-bold px-2 py-0.5 rounded-full">{ROLE_LABELS[emp.role]}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${emp.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                          {emp.status === 'active' ? 'نشط' : 'معطّل'}
                        </span>
                        {emp.mustChangePassword && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">بانتظار أول دخول</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        onClick={() => handleToggleStatus(emp)}
                        className={`flex items-center gap-1 text-[10.5px] font-bold px-2.5 py-1.5 rounded-lg border ${
                          emp.status === 'active'
                            ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                        }`}
                      >
                        {emp.status === 'active' ? <ShieldOff className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                        <span>{emp.status === 'active' ? 'تعطيل الحساب' : 'تفعيل الحساب'}</span>
                      </button>
                      <button
                        onClick={() => handleResetCredential(emp)}
                        className="flex items-center gap-1 text-[10.5px] font-bold px-2.5 py-1.5 rounded-lg border bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        <span>إعادة تعيين بيانات الدخول</span>
                      </button>
                      <button
                        onClick={() => handleRevokeSessions(emp)}
                        className="flex items-center gap-1 text-[10.5px] font-bold px-2.5 py-1.5 rounded-lg border bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>تسجيل خروج من كل الأجهزة</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="bg-slate-100/90 p-3.5 border-t border-slate-200 flex justify-end shrink-0">
          <button onClick={onClose} className="bg-slate-900 hover:bg-slate-800 text-white font-bold px-6 py-2.5 rounded-xl text-xs">
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
};
