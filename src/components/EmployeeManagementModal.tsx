import React, { useState, useEffect } from 'react';
import { UserPlus, ShieldCheck, ShieldOff, KeyRound, LogOut, Copy, Check, Plus, Users } from 'lucide-react';
import { AuthUser } from './AuthModal';
import { legacyAuthHeaders } from '../services/legacyAuthHeaders';
import { Sheet, Card, Field, Input, Select, Button, Badge, Alert, EmptyState, FormSection } from './ui';
import type { Tone } from './ui';

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

const ROLE_LABELS: Record<Employee['role'], string> = { driver: 'سائق', school: 'مدرسة', admin: 'مشرف عام' };

// Phase 8B — admin-only employee lifecycle management. No email dependency
// anywhere here: every temporary credential is shown exactly once, in this
// UI, immediately after the create/reset call succeeds — the admin is
// responsible for relaying it to the employee out-of-band.
export const EmployeeManagementModal: React.FC<EmployeeManagementModalProps> = ({ isOpen, onClose, currentUser }) => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Employee['role']>('driver');
  const [phone, setPhone] = useState('');

  const [revealedCredential, setRevealedCredential] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Phase 14 — provisioning health state. Declared here, alongside every
  // other hook, and unconditionally on every render — the `if (!isOpen)
  // return null` below must never sit between hook declarations (a real
  // "Rendered more hooks than during the previous render" crash, live-
  // caught during this phase's own browser verification, happened when
  // these were first added after that early return).
  const [auditReport, setAuditReport] = useState<Record<string, unknown[]> | null>(null);
  const [reconcileResult, setReconcileResult] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

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
      const res = await fetch('/api/admin/employees', { method: 'POST', headers, body: JSON.stringify({ name: name.trim(), email: email.trim(), role, phone: phone.trim() || undefined }) });
      const data = await res.json();
      if (data.success) {
        setRevealedCredential({ email: data.employee.email, password: data.temporaryPassword });
        setName('');
        setEmail('');
        setPhone('');
        setShowForm(false);
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

  // Phase 14 — provisioning health. Read-only audit (never auto-fixes
  // anything) plus a one-click, idempotent reconciliation for the two
  // known one-sided-account gaps (a real account that exists on only one
  // of the legacy/governed sides — see ProvisioningService.ts). Never runs
  // automatically; an admin must explicitly request it.
  const loadAudit = () => {
    if (!currentUser?.sessionToken) return;
    setAuditLoading(true);
    fetch('/api/admin/provisioning/audit', { headers: legacyAuthHeaders(currentUser.sessionToken) })
      .then((r) => r.json())
      .then((data) => setAuditReport(data))
      .catch(() => setError('تعذّر تحميل تقرير تكامل البيانات.'))
      .finally(() => setAuditLoading(false));
  };

  const handleReconcile = async () => {
    setError(null);
    setReconcileResult(null);
    try {
      const res = await fetch('/api/admin/provisioning/reconcile', { method: 'POST', headers });
      const data = await res.json();
      if (data.success) {
        const total = (data.governedUsersCreated?.length ?? 0) + (data.governedDriversCreated?.length ?? 0) + (data.legacyLoginsCreated?.length ?? 0);
        setReconcileResult(total === 0 ? 'كل الحسابات متوافقة بالفعل — لا يوجد ما يحتاج إصلاحاً.' : `تم إصلاح ${total} حساباً. راجع أي كلمات مرور مؤقتة جديدة أدناه وسلّمها للموظف المعني شخصياً.`);
        if (data.legacyLoginsCreated?.length) {
          setRevealedCredential({ email: data.legacyLoginsCreated[0].email, password: data.legacyLoginsCreated[0].temporaryPassword });
        }
        loadEmployees();
        loadAudit();
      } else {
        setError(data.error || 'تعذّر تنفيذ عملية المطابقة.');
      }
    } catch {
      setError('حدث خطأ في الاتصال بالخادم.');
    }
  };

  return (
    <Sheet isOpen={isOpen} onClose={onClose} title="إدارة الموظفين" subtitle="حسابات السائقين وموظفي المدرسة">
      <div className="space-y-4">
        {revealedCredential && (
          <div className="bg-warning-soft border border-warning-border rounded-2xl p-4 space-y-2">
            <div className="flex items-center gap-2 text-amber-900 font-bold text-sm">
              <KeyRound className="w-4 h-4" />
              <span>كلمة المرور المؤقتة — تُعرض مرة واحدة فقط</span>
            </div>
            <p className="text-xs text-amber-800">شارك هذه البيانات مع الموظف مباشرة (شخصياً أو هاتفياً) — لا يوجد بريد إلكتروني مُفعّل لإرسالها تلقائياً.</p>
            <div className="bg-surface border border-warning-border rounded-xl p-3 flex items-center justify-between gap-3" dir="ltr">
              <div className="text-sm">
                <div className="text-text-secondary text-xs">{revealedCredential.email}</div>
                <div className="font-bold text-text-primary">{revealedCredential.password}</div>
              </div>
              <Button size="sm" variant="secondary" icon={copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} onClick={copyToClipboard}>
                {copied ? 'تم النسخ' : 'نسخ'}
              </Button>
            </div>
            <button onClick={() => setRevealedCredential(null)} className="text-xs text-amber-700 font-bold underline">
              فهمت، إخفاء هذا التنبيه
            </button>
          </div>
        )}

        {error && <Alert tone="danger" title={error} onDismiss={() => setError(null)} />}

        {!showForm ? (
          <Button variant="secondary" fullWidth icon={<UserPlus className="w-4 h-4" />} onClick={() => setShowForm(true)}>
            إضافة موظف جديد
          </Button>
        ) : (
          <Card as="form" onSubmit={handleCreate} className="space-y-4">
            <FormSection title="حساب موظف جديد" description="سائق، مدرسة، أو مشرف عام">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="الاسم الكامل" required>
                  <Input required value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="البريد الإلكتروني (للدخول)" required>
                  <Input type="email" required dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} className="text-right" />
                </Field>
                <Field label="الدور الوظيفي" className="sm:col-span-2">
                  <Select value={role} onChange={(e) => setRole(e.target.value as Employee['role'])}>
                    <option value="driver">سائق</option>
                    <option value="school">مدرسة</option>
                    <option value="admin">مشرف عام</option>
                  </Select>
                </Field>
                {role === 'driver' && (
                  <Field label="رقم جوال السائق" className="sm:col-span-2">
                    <Input dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} className="text-right" />
                  </Field>
                )}
              </div>
            </FormSection>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setShowForm(false)}>إلغاء</Button>
              <Button type="submit" fullWidth icon={<Plus className="w-4 h-4" />}>إنشاء الحساب</Button>
            </div>
          </Card>
        )}

        <div>
          <h3 className="text-sm font-bold text-text-primary mb-2">الموظفون ({employees.length})</h3>
          {loading ? (
            <div className="text-center py-6 text-text-tertiary text-sm">جارٍ التحميل...</div>
          ) : employees.length === 0 ? (
            <EmptyState icon={<Users />} title="لا يوجد موظفون بعد" />
          ) : (
            <div className="space-y-2">
              {employees.map((emp) => {
                const statusTone: Tone = emp.status === 'active' ? 'success' : 'danger';
                return (
                  <Card key={emp.id} padding="sm" className="space-y-2.5">
                    <div className="flex items-center justify-between flex-wrap gap-1.5">
                      <div>
                        <span className="font-bold text-sm text-text-primary">{emp.name}</span>
                        <div className="text-xs text-text-secondary" dir="ltr">{emp.email}</div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Badge tone="neutral">{ROLE_LABELS[emp.role]}</Badge>
                        <Badge tone={statusTone}>{emp.status === 'active' ? 'نشط' : 'معطّل'}</Badge>
                        {emp.mustChangePassword && <Badge tone="warning">بانتظار أول دخول</Badge>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Button
                        size="sm"
                        variant={emp.status === 'active' ? 'danger' : 'secondary'}
                        icon={emp.status === 'active' ? <ShieldOff className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                        onClick={() => handleToggleStatus(emp)}
                      >
                        {emp.status === 'active' ? 'تعطيل' : 'تفعيل'}
                      </Button>
                      <Button size="sm" variant="secondary" icon={<KeyRound className="w-3.5 h-3.5" />} onClick={() => handleResetCredential(emp)}>
                        إعادة تعيين كلمة المرور
                      </Button>
                      <Button size="sm" variant="ghost" icon={<LogOut className="w-3.5 h-3.5" />} onClick={() => handleRevokeSessions(emp)}>
                        تسجيل خروج من كل الأجهزة
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-border-default pt-4">
          <h3 className="text-sm font-bold text-text-primary mb-2">تكامل الحسابات (النظام المحوكم مقابل النظام القديم)</h3>
          <p className="text-xs text-text-secondary mb-2">
            فحص وإصلاح الحسابات التي تكون موجودة في أحد النظامين فقط — لا يتم تشغيل هذا تلقائياً أبداً، ولا يتم تخمين أي علاقة بالاسم.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="secondary" onClick={loadAudit} disabled={auditLoading}>
              {auditLoading ? 'جارٍ الفحص...' : 'فحص التكامل'}
            </Button>
            <Button size="sm" variant="secondary" onClick={handleReconcile}>
              تشغيل المطابقة والإصلاح
            </Button>
          </div>
          {reconcileResult && <p className="text-xs text-emerald-700 font-bold mt-2">{reconcileResult}</p>}
          {auditReport && (
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              {Object.entries(auditReport).map(([key, value]) => (
                <div key={key} className="bg-surface-sunken border border-border-default rounded-lg px-2 py-1.5">
                  <div className="text-text-tertiary">{key}</div>
                  <div className="font-bold text-text-primary">{Array.isArray(value) ? value.length : String(value)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
};
