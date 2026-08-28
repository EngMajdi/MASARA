import React, { useState, useEffect } from 'react';
import { Student, Bus, Route, School } from '../types';
import { AuthUser } from './AuthModal';
import { legacyAuthHeaders } from '../services/legacyAuthHeaders';
import { Sheet, Tabs, Card, Field, Input, Select, FormSection, Button, EmptyState, Alert } from './ui';
import type { TabItem } from './ui';
import { Users, Bus as BusIcon, Navigation, Trash2, UserPlus, Search, Route as RouteIcon } from 'lucide-react';

interface EmployeeSummary {
  id: string;
  name: string;
  email: string;
  role: 'driver' | 'school' | 'admin' | 'parent';
  status: 'active' | 'disabled';
}

interface DataManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  schools: School[];
  buses: Bus[];
  students: Student[];
  routes: Route[];
  currentUser: AuthUser | null;
  onAddStudent: (newStudent: Omit<Student, 'id'>) => void;
  onDeleteStudent: (id: string) => void;
  onAddBus: (newBus: Omit<Bus, 'id' | 'driverId'>) => void;
  onDeleteBus: (id: string) => void;
  onAddRoute: (newRoute: Omit<Route, 'id'>) => void;
  onDeleteRoute: (id: string) => void;
}

const TABS: TabItem[] = [
  { id: 'students', label: 'الطلاب', icon: <Users className="w-4 h-4" /> },
  { id: 'buses', label: 'الحافلات', icon: <BusIcon className="w-4 h-4" /> },
  { id: 'routes', label: 'المسارات', icon: <Navigation className="w-4 h-4" /> }
];

export const DataManagementModal: React.FC<DataManagementModalProps> = ({
  isOpen,
  onClose,
  schools,
  buses,
  students,
  routes,
  currentUser,
  onAddStudent,
  onDeleteStudent,
  onAddBus,
  onDeleteBus,
  onAddRoute,
  onDeleteRoute
}) => {
  const [activeTab, setActiveTab] = useState<'students' | 'buses' | 'routes'>('students');
  const [searchTerm, setSearchTerm] = useState('');
  const [showStudentForm, setShowStudentForm] = useState(false);
  const [showBusForm, setShowBusForm] = useState(false);
  const [showRouteForm, setShowRouteForm] = useState(false);

  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [parentAccounts, setParentAccounts] = useState<EmployeeSummary[]>([]);
  const [assignMsg, setAssignMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Phase 14 — the real governed buses (the ones Parent Live Journey/GPS
  // actually run against), for the "enable live tracking" step below.
  const [governedBuses, setGovernedBuses] = useState<{ id: string; busNumber: string }[]>([]);
  const [liveTrackingBusChoice, setLiveTrackingBusChoice] = useState<Record<string, string>>({});
  const [liveTrackingEnabled, setLiveTrackingEnabled] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isOpen || !currentUser?.sessionToken) return;
    const headers = legacyAuthHeaders(currentUser.sessionToken);
    fetch('/api/admin/employees', { headers }).then((r) => r.json()).then((data) => data.success && setEmployees(data.employees)).catch(() => {});
    fetch('/api/admin/parents', { headers }).then((r) => r.json()).then((data) => data.success && setParentAccounts(data.parents)).catch(() => {});
    fetch('/api/governed/buses', { headers }).then((r) => r.json()).then((data) => Array.isArray(data) && setGovernedBuses(data)).catch(() => {});
  }, [isOpen, currentUser?.sessionToken]);

  const handleEnableLiveTracking = async (legacyStudentId: string) => {
    const governedBusId = liveTrackingBusChoice[legacyStudentId];
    if (!governedBusId) {
      setAssignMsg('يرجى اختيار الحافلة الحقيقية (النظام المحوكم) أولاً');
      setTimeout(() => setAssignMsg(null), 3000);
      return;
    }
    try {
      const res = await fetch(`/api/students/${legacyStudentId}/provision-governed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(currentUser?.sessionToken) },
        body: JSON.stringify({ busId: governedBusId })
      });
      const data = await res.json();
      if (data.success) {
        setLiveTrackingEnabled((prev) => ({ ...prev, [legacyStudentId]: true }));
        showToast('تم تفعيل التتبع المباشر لهذا الطالب');
      } else {
        setAssignMsg(data.error || 'تعذّر تفعيل التتبع المباشر');
        setTimeout(() => setAssignMsg(null), 3000);
      }
    } catch {
      setAssignMsg('حدث خطأ في الاتصال بالخادم');
      setTimeout(() => setAssignMsg(null), 3000);
    }
  };

  const activeDrivers = employees.filter((e) => e.role === 'driver' && e.status === 'active');
  const activeParents = parentAccounts.filter((e) => e.status === 'active');

  const showToast = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const handleAssignDriver = async (busId: string, driverId: string | null) => {
    try {
      const res = await fetch(`/api/buses/${busId}/assign-driver`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(currentUser?.sessionToken) },
        body: JSON.stringify({ driverId })
      });
      const data = await res.json();
      setAssignMsg(data.success ? 'تم تحديث إسناد السائق' : data.error || 'تعذّر تحديث الإسناد');
    } catch {
      setAssignMsg('حدث خطأ في الاتصال بالخادم');
    } finally {
      setTimeout(() => setAssignMsg(null), 3000);
    }
  };

  const handleAssignParent = async (studentId: string, parentId: string | null) => {
    try {
      const res = await fetch(`/api/students/${studentId}/assign-parent`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(currentUser?.sessionToken) },
        body: JSON.stringify({ parentId })
      });
      const data = await res.json();
      setAssignMsg(data.success ? 'تم تحديث إسناد ولي الأمر' : data.error || 'تعذّر تحديث الإسناد');
    } catch {
      setAssignMsg('حدث خطأ في الاتصال بالخادم');
    } finally {
      setTimeout(() => setAssignMsg(null), 3000);
    }
  };

  // Student form
  const [studentName, setStudentName] = useState('');
  const [studentGrade, setStudentGrade] = useState('الصف الرابع - الابتدائي');
  const [parentName, setParentName] = useState('');
  const [parentPhone, setParentPhone] = useState('+968 91234567');
  const [schoolId, setSchoolId] = useState(schools[0]?.id || '');
  const [busId, setBusId] = useState(buses[0]?.id || '');
  const [seatNumber, setSeatNumber] = useState('12');
  const [neighborhood, setNeighborhood] = useState('حي القرم - الشارع العام (مسقط)');

  // Bus form
  const [busNumber, setBusNumber] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [capacity, setCapacity] = useState('30');

  // Route form
  const [routeNameAr, setRouteNameAr] = useState('');
  const [routeDistance, setRouteDistance] = useState('12');
  const [routeDuration, setRouteDuration] = useState('20');

  if (!isOpen) return null;

  const handleCreateStudent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentName.trim() || !parentName.trim()) return;
    const selectedSchool = schools.find((s) => s.id === schoolId) || schools[0];
    const selectedBus = buses.find((b) => b.id === busId) || buses[0];
    onAddStudent({
      name: studentName,
      grade: studentGrade,
      avatar: 'https://images.unsplash.com/photo-1544717305-2782549b5136?w=150&auto=format&fit=crop&q=80',
      schoolId: selectedSchool?.id || '',
      schoolName: selectedSchool?.nameAr || '',
      parentId: null,
      parentName,
      parentPhone,
      busId: selectedBus?.id || '',
      busNumber: selectedBus?.busNumber || '',
      pickupPoint: { lat: 23.595, lng: 58.405, address: neighborhood, nameAr: neighborhood },
      status: 'at_home',
      pickupTimePlanned: '06:45 ص',
      seatNumber: seatNumber || '1'
    });
    setStudentName('');
    setParentName('');
    setShowStudentForm(false);
    showToast(`تمت إضافة الطالب ${studentName}`);
  };

  const handleCreateBus = (e: React.FormEvent) => {
    e.preventDefault();
    if (!busNumber.trim() || !driverName.trim()) return;
    onAddBus({
      busNumber,
      plateNumber,
      driverName,
      driverPhone,
      driverAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
      capacity: parseInt(capacity, 10) || 30,
      currentOccupancy: 0,
      currentLocation: { lat: 23.598, lng: 58.41 },
      speedKmH: 0,
      status: 'idle',
      fuelLevel: 100,
      safetyScore: 99,
      assignedRouteId: routes[0]?.id || '',
      nextStopName: '—',
      nextStopEtaMins: 10
    });
    setBusNumber('');
    setDriverName('');
    setShowBusForm(false);
    showToast(`تمت إضافة الحافلة ${busNumber}`);
  };

  const handleCreateRoute = (e: React.FormEvent) => {
    e.preventDefault();
    if (!routeNameAr.trim()) return;
    const selectedSchool = schools[0];
    const selectedBus = buses[0];
    onAddRoute({
      routeNameAr,
      schoolId: selectedSchool?.id || '',
      busId: selectedBus?.id || '',
      waypoints: [
        { lat: 23.595, lng: 58.405, type: 'start', label: 'بداية الانطلاق' },
        { lat: 23.61, lng: 58.42, type: 'school', label: selectedSchool?.nameAr || 'المدرسة' }
      ],
      stops: [],
      totalDistanceKm: parseFloat(routeDistance) || 12,
      estimatedDurationMins: parseInt(routeDuration, 10) || 20,
      status: 'scheduled',
      aiEfficiencyScore: 0,
      carbonSavedKg: 0,
      aiRationaleAr: 'مسار جديد أُنشئ يدوياً عبر إدارة البيانات.'
    });
    setRouteNameAr('');
    setShowRouteForm(false);
    showToast(`تم إنشاء المسار ${routeNameAr}`);
  };

  const filteredStudents = students.filter((s) => s.name.includes(searchTerm) || s.parentName.includes(searchTerm) || s.busNumber.includes(searchTerm));
  const filteredBuses = buses.filter((b) => b.busNumber.includes(searchTerm) || b.driverName.includes(searchTerm) || b.plateNumber.includes(searchTerm));
  const filteredRoutes = routes.filter((r) => r.routeNameAr.includes(searchTerm));

  return (
    <Sheet isOpen={isOpen} onClose={onClose} title="إدارة البيانات" subtitle="الطلاب، الحافلات، والمسارات المدرسية">
      <div className="space-y-4">
        {successMsg && <Alert tone="success" title={successMsg} />}
        {assignMsg && <Alert tone="info" title={assignMsg} />}

        <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <Tabs items={TABS} activeId={activeTab} onChange={(id) => setActiveTab(id as typeof activeTab)} />
          <div className="relative">
            <Search className="w-4 h-4 text-text-tertiary absolute right-3 top-1/2 -translate-y-1/2" />
            <Input placeholder="بحث..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pr-9 h-10 w-full sm:w-52" />
          </div>
        </div>

        {activeTab === 'students' && (
          <div className="space-y-3">
            {!showStudentForm ? (
              <Button variant="secondary" fullWidth icon={<UserPlus className="w-4 h-4" />} onClick={() => setShowStudentForm(true)}>
                إضافة طالب جديد
              </Button>
            ) : (
              <Card as="form" onSubmit={handleCreateStudent} className="space-y-4">
                <FormSection title="بيانات الطالب">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="اسم الطالب" required>
                      <Input required placeholder="مثال: سلمان بن سيف العتيبي" value={studentName} onChange={(e) => setStudentName(e.target.value)} />
                    </Field>
                    <Field label="الصف الدراسي">
                      <Select value={studentGrade} onChange={(e) => setStudentGrade(e.target.value)}>
                        {['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس'].map((g) => (
                          <option key={g} value={`الصف ${g} - الابتدائي`}>الصف {g} - الابتدائي</option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                </FormSection>

                <FormSection title="ولي الأمر والنقل">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="اسم ولي الأمر" required>
                      <Input required placeholder="مثال: سيف بن عبدالله العتيبي" value={parentName} onChange={(e) => setParentName(e.target.value)} />
                    </Field>
                    <Field label="رقم الجوال">
                      <Input dir="ltr" value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} />
                    </Field>
                    <Field label="المدرسة">
                      <Select value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
                        {schools.map((sch) => <option key={sch.id} value={sch.id}>{sch.nameAr}</option>)}
                      </Select>
                    </Field>
                    <Field label="الحافلة">
                      <Select value={busId} onChange={(e) => setBusId(e.target.value)}>
                        {buses.map((bus) => <option key={bus.id} value={bus.id}>{bus.busNumber} ({bus.driverName})</option>)}
                      </Select>
                    </Field>
                    <Field label="الحي والموقع">
                      <Input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} />
                    </Field>
                    <Field label="رقم المقعد">
                      <Input value={seatNumber} onChange={(e) => setSeatNumber(e.target.value)} />
                    </Field>
                  </div>
                </FormSection>

                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setShowStudentForm(false)}>إلغاء</Button>
                  <Button type="submit" fullWidth>حفظ الطالب</Button>
                </div>
              </Card>
            )}

            {filteredStudents.length === 0 ? (
              <EmptyState icon={<Users />} title="لا توجد نتائج" />
            ) : (
              <div className="space-y-2">
                {filteredStudents.map((std) => (
                  <Card key={std.id} padding="sm" className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <img src={std.avatar} alt={std.name} className="w-9 h-9 rounded-full object-cover border border-border-default shrink-0" />
                        <div className="min-w-0">
                          <div className="font-bold text-sm text-text-primary truncate">{std.name}</div>
                          <div className="text-xs text-text-secondary truncate">{std.grade} · {std.busNumber} · مقعد {std.seatNumber}</div>
                        </div>
                      </div>
                      <button onClick={() => onDeleteStudent(std.id)} className="text-text-tertiary hover:text-danger p-1.5 rounded-lg hover:bg-danger-soft shrink-0" title="حذف">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 border-t border-border-default pt-2">
                      <label className="text-xs text-text-secondary font-bold shrink-0">ولي الأمر:</label>
                      <select
                        value={(std.parentId as string | null) || ''}
                        onChange={(e) => handleAssignParent(std.id, e.target.value || null)}
                        className="flex-1 bg-surface-sunken border border-border-default rounded-lg px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-primary"
                      >
                        <option value="">— غير مُسند —</option>
                        {activeParents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    {std.parentId && (
                      <div className="flex items-center gap-2 border-t border-border-default pt-2">
                        <label className="text-xs text-text-secondary font-bold shrink-0">التتبع المباشر:</label>
                        {liveTrackingEnabled[std.id] ? (
                          <span className="text-xs text-emerald-700 font-bold">مُفعّل ✓</span>
                        ) : (
                          <>
                            <select
                              value={liveTrackingBusChoice[std.id] || ''}
                              onChange={(e) => setLiveTrackingBusChoice((prev) => ({ ...prev, [std.id]: e.target.value }))}
                              className="flex-1 bg-surface-sunken border border-border-default rounded-lg px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-primary"
                            >
                              <option value="">— اختر حافلة حقيقية —</option>
                              {governedBuses.map((b) => <option key={b.id} value={b.id}>{b.busNumber}</option>)}
                            </select>
                            <button
                              onClick={() => handleEnableLiveTracking(std.id)}
                              className="text-xs font-bold text-primary bg-primary-soft px-2.5 py-1 rounded-lg shrink-0 hover:opacity-80"
                            >
                              تفعيل
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'buses' && (
          <div className="space-y-3">
            {!showBusForm ? (
              <Button variant="secondary" fullWidth icon={<BusIcon className="w-4 h-4" />} onClick={() => setShowBusForm(true)}>
                إضافة حافلة جديدة
              </Button>
            ) : (
              <Card as="form" onSubmit={handleCreateBus} className="space-y-4">
                <FormSection title="بيانات الحافلة">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="رقم الحافلة" required>
                      <Input required placeholder="مثال: حافلة 104" value={busNumber} onChange={(e) => setBusNumber(e.target.value)} />
                    </Field>
                    <Field label="رقم اللوحة">
                      <Input dir="ltr" placeholder="مثال: 999 ط ع" value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} />
                    </Field>
                    <Field label="السعة (عدد المقاعد)">
                      <Input type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
                    </Field>
                  </div>
                </FormSection>
                <FormSection title="السائق">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="اسم السائق" required>
                      <Input required placeholder="مثال: سالم المعمري" value={driverName} onChange={(e) => setDriverName(e.target.value)} />
                    </Field>
                    <Field label="رقم الجوال">
                      <Input dir="ltr" value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} />
                    </Field>
                  </div>
                </FormSection>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setShowBusForm(false)}>إلغاء</Button>
                  <Button type="submit" fullWidth>حفظ الحافلة</Button>
                </div>
              </Card>
            )}

            {filteredBuses.length === 0 ? (
              <EmptyState icon={<BusIcon />} title="لا توجد نتائج" />
            ) : (
              <div className="space-y-2">
                {filteredBuses.map((b) => (
                  <Card key={b.id} padding="sm" className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="font-bold text-sm text-text-primary">{b.busNumber} <span className="text-text-tertiary font-normal">{b.plateNumber}</span></div>
                        <div className="text-xs text-text-secondary">{b.driverName} · {b.capacity} مقعد</div>
                      </div>
                      <button onClick={() => onDeleteBus(b.id)} className="text-text-tertiary hover:text-danger p-1.5 rounded-lg hover:bg-danger-soft shrink-0" title="حذف">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 border-t border-border-default pt-2">
                      <label className="text-xs text-text-secondary font-bold shrink-0">السائق:</label>
                      <select
                        value={(b.driverId as string | null) || ''}
                        onChange={(e) => handleAssignDriver(b.id, e.target.value || null)}
                        className="flex-1 bg-surface-sunken border border-border-default rounded-lg px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-primary"
                      >
                        <option value="">— غير مُسند —</option>
                        {activeDrivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'routes' && (
          <div className="space-y-3">
            {!showRouteForm ? (
              <Button variant="secondary" fullWidth icon={<RouteIcon className="w-4 h-4" />} onClick={() => setShowRouteForm(true)}>
                إضافة مسار جديد
              </Button>
            ) : (
              <Card as="form" onSubmit={handleCreateRoute} className="space-y-4">
                <FormSection title="بيانات المسار">
                  <Field label="اسم المسار" required>
                    <Input required placeholder="مثال: مسار حطين - مدرسة المسار الدولية" value={routeNameAr} onChange={(e) => setRouteNameAr(e.target.value)} />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="المسافة (كم)">
                      <Input value={routeDistance} onChange={(e) => setRouteDistance(e.target.value)} />
                    </Field>
                    <Field label="الزمن المتوقع (دقيقة)">
                      <Input value={routeDuration} onChange={(e) => setRouteDuration(e.target.value)} />
                    </Field>
                  </div>
                </FormSection>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setShowRouteForm(false)}>إلغاء</Button>
                  <Button type="submit" fullWidth>حفظ المسار</Button>
                </div>
              </Card>
            )}

            {filteredRoutes.length === 0 ? (
              <EmptyState icon={<RouteIcon />} title="لا توجد مسارات" />
            ) : (
              <div className="space-y-2">
                {filteredRoutes.map((r) => (
                  <Card key={r.id} padding="sm" className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-bold text-sm text-text-primary truncate">{r.routeNameAr}</div>
                      <div className="text-xs text-text-secondary">{r.totalDistanceKm} كم · {r.estimatedDurationMins} دقيقة</div>
                    </div>
                    <button onClick={() => onDeleteRoute(r.id)} className="text-text-tertiary hover:text-danger p-1.5 rounded-lg hover:bg-danger-soft shrink-0" title="حذف">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
};
