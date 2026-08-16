import React, { useState } from 'react';
import { Student, Bus, Route, School } from '../types';
import { SwipeableCard } from './SwipeableCard';
import {
  X,
  Plus,
  Users,
  Bus as BusIcon,
  Navigation,
  Trash2,
  CheckCircle2,
  UserPlus,
  ShieldAlert,
  Building2,
  Phone,
  MapPin,
  Calendar,
  Sparkles,
  Database,
  Search,
  Check,
  ArrowRightLeft
} from 'lucide-react';

interface DataManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  schools: School[];
  buses: Bus[];
  students: Student[];
  routes: Route[];
  onAddStudent: (newStudent: Omit<Student, 'id'>) => void;
  onDeleteStudent: (id: string) => void;
  onAddBus: (newBus: Omit<Bus, 'id'>) => void;
  onDeleteBus: (id: string) => void;
  onAddRoute: (newRoute: Omit<Route, 'id'>) => void;
  onDeleteRoute: (id: string) => void;
}

export const DataManagementModal: React.FC<DataManagementModalProps> = ({
  isOpen,
  onClose,
  schools,
  buses,
  students,
  routes,
  onAddStudent,
  onDeleteStudent,
  onAddBus,
  onDeleteBus,
  onAddRoute,
  onDeleteRoute
}) => {
  const [activeTab, setActiveTab] = useState<'students' | 'buses' | 'routes'>('students');
  const [searchTerm, setSearchTerm] = useState('');

  // Student Form State
  const [studentName, setStudentName] = useState('');
  const [studentGrade, setStudentGrade] = useState('الصف الرابع - الابتدائي');
  const [parentName, setParentName] = useState('');
  const [parentPhone, setParentPhone] = useState('+968 91234567');
  const [schoolId, setSchoolId] = useState(schools[0]?.id || 'sch-1');
  const [busId, setBusId] = useState(buses[0]?.id || 'bus-101');
  const [seatNumber, setSeatNumber] = useState('12');
  const [neighborhood, setNeighborhood] = useState('حي القرم - الشارع العام (مسقط)');

  // Bus Form State
  const [busNumber, setBusNumber] = useState('حافلة 103');
  const [plateNumber, setPlateNumber] = useState('ط ع 999');
  const [driverName, setDriverName] = useState('سالم المعمري');
  const [driverPhone, setDriverPhone] = useState('+968 90123456');
  const [capacity, setCapacity] = useState('30');

  // Route Form State
  const [routeNameAr, setRouteNameAr] = useState('مسار الخوض - مدرسة المسار القرم');
  const [routeDistance, setRouteDistance] = useState('14.2');
  const [routeDuration, setRouteDuration] = useState('25');

  const [successToast, setSuccessToast] = useState<string | null>(null);

  if (!isOpen) return null;

  const showToast = (msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => setSuccessToast(null), 3000);
  };

  const handleCreateStudent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentName.trim() || !parentName.trim()) return;

    const selectedSchool = schools.find((s) => s.id === schoolId) || schools[0];
    const selectedBus = buses.find((b) => b.id === busId) || buses[0];

    onAddStudent({
      name: studentName,
      grade: studentGrade,
      avatar: `https://images.unsplash.com/photo-1544717305-2782549b5136?w=150&auto=format&fit=crop&q=80`,
      schoolId: selectedSchool?.id || 'sch-1',
      schoolName: selectedSchool?.nameAr || 'مدرسة المسار الدولية',
      parentId: 'par-new',
      parentName: parentName,
      parentPhone: parentPhone,
      busId: selectedBus?.id || 'bus-101',
      busNumber: selectedBus?.busNumber || 'حافلة 101',
      pickupPoint: {
        lat: 23.5950,
        lng: 58.4050,
        address: neighborhood,
        nameAr: neighborhood
      },
      status: 'at_home',
      pickupTimePlanned: '06:45 ص',
      seatNumber: seatNumber || '15'
    });

    setStudentName('');
    setParentName('');
    showToast(`تمت إضافة الطالب (${studentName}) بنجاح إلى قاعدة البيانات!`);
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
      currentLocation: { lat: 23.5980, lng: 58.4100 },
      speedKmH: 0,
      status: 'idle',
      fuelLevel: 100,
      safetyScore: 99,
      assignedRouteId: routes[0]?.id || 'route-1',
      nextStopName: 'حي النرجس',
      nextStopEtaMins: 10
    });

    showToast(`تمت إضافة الحافلة (${busNumber}) والسائق (${driverName}) بنجاح!`);
  };

  const handleCreateRoute = (e: React.FormEvent) => {
    e.preventDefault();
    if (!routeNameAr.trim()) return;

    const selectedSchool = schools[0];
    const selectedBus = buses[0];

    onAddRoute({
      routeNameAr,
      schoolId: selectedSchool?.id || 'sch-1',
      busId: selectedBus?.id || 'bus-101',
      waypoints: [
        { lat: 23.5950, lng: 58.4050, type: 'start', label: 'بداية الانطلاق' },
        { lat: 23.6100, lng: 58.4200, type: 'school', label: selectedSchool?.nameAr || 'المدرسة' }
      ],
      stops: [],
      totalDistanceKm: parseFloat(routeDistance) || 12,
      estimatedDurationMins: parseInt(routeDuration, 10) || 20,
      status: 'scheduled',
      aiEfficiencyScore: 95,
      carbonSavedKg: 4.5,
      aiRationaleAr: 'مسار جديد مخصص تم إنشاؤه عبر مركز إدارة البيانات.'
    });

    showToast(`تم إنشاء المسار المدرسي الجديد (${routeNameAr}) بنجاح!`);
  };

  // Filtered Lists
  const filteredStudents = students.filter(
    (s) =>
      s.name.includes(searchTerm) ||
      s.parentName.includes(searchTerm) ||
      s.busNumber.includes(searchTerm)
  );

  const filteredBuses = buses.filter(
    (b) =>
      b.busNumber.includes(searchTerm) ||
      b.driverName.includes(searchTerm) ||
      b.plateNumber.includes(searchTerm)
  );

  const filteredRoutes = routes.filter((r) => r.routeNameAr.includes(searchTerm));

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto font-['Tajawal',sans-serif]">
      {/* Background ambient light */}
      <div className="fixed inset-0 pointer-events-none opacity-20 bg-[radial-gradient(circle_at_50%_15%,#2563eb,transparent_60%)]"></div>

      <div className="bg-white border border-slate-200/90 rounded-3xl w-full max-w-3xl shadow-2xl overflow-hidden relative text-slate-900 my-auto z-10 max-h-[92vh] flex flex-col animate-fade-in">
        
        {/* Fixed Header */}
        <div className="bg-slate-950 p-4 sm:p-5 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-600/30 text-blue-400 rounded-2xl border border-blue-400/30 shrink-0">
              <Database className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black tracking-tight text-white font-['Tajawal']">
                  مركز إدخال وإدارة البيانات الموحد
                </h3>
                <span className="bg-blue-500/20 text-blue-300 border border-blue-400/30 text-[10px] font-bold px-2 py-0.5 rounded-full hidden xs:inline">
                  مَسارَا
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400 font-medium">
                إضافة وتحديث سجلات الطلاب، الحافلات، السائقين والمسارات المدرسية
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 shrink-0"
            title="إغلاق النافذة"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Success Toast Notification */}
        {successToast && (
          <div className="bg-emerald-600 text-white px-4 py-2.5 text-xs font-bold flex items-center gap-2 animate-fade-in shrink-0 border-b border-emerald-700">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successToast}</span>
          </div>
        )}

        {/* Fixed Navigation Tabs Bar */}
        <div className="bg-slate-100/90 px-3 sm:px-5 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 w-full xs:w-auto">
            <button
              onClick={() => setActiveTab('students')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
                activeTab === 'students'
                  ? 'bg-blue-600 text-white shadow-xs border border-blue-700'
                  : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-200/80'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>إدارة الطلاب ({students.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('buses')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
                activeTab === 'buses'
                  ? 'bg-blue-600 text-white shadow-xs border border-blue-700'
                  : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-200/80'
              }`}
            >
              <BusIcon className="w-4 h-4" />
              <span>الحافلات والسائقين ({buses.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('routes')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
                activeTab === 'routes'
                  ? 'bg-blue-600 text-white shadow-xs border border-blue-700'
                  : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-200/80'
              }`}
            >
              <Navigation className="w-4 h-4" />
              <span>المسارات المدرسية ({routes.length})</span>
            </button>
          </div>

          {/* Quick Search Filter */}
          <div className="relative w-full xs:w-48 sm:w-56 shrink-0">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              placeholder="بحث في السجلات..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pr-8 pl-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-blue-600 shadow-2xs font-medium"
            />
          </div>
        </div>

        {/* Scrollable Modal Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-6 bg-slate-50/50">
          
          {/* TAB 1: STUDENTS */}
          {activeTab === 'students' && (
            <div className="space-y-5">
              {/* Add Student Form */}
              <form onSubmit={handleCreateStudent} className="bg-white border border-slate-200/90 p-4 sm:p-5 rounded-2xl shadow-2xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                  <h4 className="font-bold text-xs sm:text-sm text-slate-900 flex items-center gap-2">
                    <UserPlus className="w-4 h-4 text-blue-600" />
                    <span>إضافة طالب جديد للنظام</span>
                  </h4>
                  <span className="text-[10px] text-blue-700 font-bold bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">
                    تحديث فوري للمسار
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1">اسم الطالب رباعي:</label>
                    <input
                      type="text"
                      required
                      placeholder="مثال: سلمان بن سيف العتيبي"
                      value={studentName}
                      onChange={(e) => setStudentName(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">الصف الدراسي:</label>
                    <select
                      value={studentGrade}
                      onChange={(e) => setStudentGrade(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all font-medium"
                    >
                      <option>الصف الأول - الابتدائي</option>
                      <option>الصف الثاني - الابتدائي</option>
                      <option>الصف الثالث - الابتدائي</option>
                      <option>الصف الرابع - الابتدائي</option>
                      <option>الصف الخامس - الابتدائي</option>
                      <option>الصف السادس - الابتدائي</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">اسم ولي الأمر:</label>
                    <input
                      type="text"
                      required
                      placeholder="مثال: سيف بن عبدالله العتيبي"
                      value={parentName}
                      onChange={(e) => setParentName(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">رقم جوال ولي الأمر:</label>
                    <input
                      type="text"
                      required
                      value={parentPhone}
                      onChange={(e) => setParentPhone(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all font-medium font-sans dir-ltr text-right"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">المدرسة المسندة:</label>
                    <select
                      value={schoolId}
                      onChange={(e) => setSchoolId(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all font-medium"
                    >
                      {schools.map((sch) => (
                        <option key={sch.id} value={sch.id}>
                          {sch.nameAr}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">الحافلة المخصصة:</label>
                    <select
                      value={busId}
                      onChange={(e) => setBusId(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all font-medium"
                    >
                      {buses.map((bus) => (
                        <option key={bus.id} value={bus.id}>
                          {bus.busNumber} ({bus.driverName})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">الحي والموقع (مسقط):</label>
                    <input
                      type="text"
                      value={neighborhood}
                      onChange={(e) => setNeighborhood(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">رقم المقعد:</label>
                    <input
                      type="text"
                      value={seatNumber}
                      onChange={(e) => setSeatNumber(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all font-medium"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-5 py-2.5 rounded-xl text-xs flex items-center gap-2 shadow-sm transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    <span>حفظ وإضافة الطالب</span>
                  </button>
                </div>
              </form>

              {/* Existing Students List */}
              <div className="bg-white border border-slate-200/90 p-4 rounded-2xl shadow-2xs space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-bold text-xs text-slate-800">
                    قائمة الطلاب المسجلين حالياً ({filteredStudents.length}):
                  </h4>
                  <div className="flex items-center gap-1.5 text-[10px] text-blue-700 bg-blue-50 px-2.5 py-1 rounded-xl border border-blue-200/80 font-bold">
                    <ArrowRightLeft className="w-3 h-3 text-blue-600" />
                    <span>إيماءة الجوال: اسحب البطاقة لليسار للحذف السريع 👈</span>
                  </div>
                </div>

                <div className="max-h-60 overflow-y-auto space-y-2.5 pr-1">
                  {filteredStudents.length === 0 ? (
                    <div className="text-center py-6 text-slate-400 text-xs">لا توجد نتائج مطابقة للبحث</div>
                  ) : (
                    filteredStudents.map((std) => (
                      <SwipeableCard
                        key={std.id}
                        onSwipeLeft={() => {
                          onDeleteStudent(std.id);
                          showToast(`تم حذف الطالب (${std.name}) عبر إيماءة التمرير`);
                        }}
                        onSwipeRight={() => {
                          showToast(`عرض بيانات الطالب: ${std.name} (${std.parentName})`);
                        }}
                        leftActionLabel="حذف الطالب"
                        leftActionColor="rose"
                        rightActionLabel="عرض التفاصيل"
                        rightActionColor="blue"
                        rightActionIcon={<Phone className="w-4 h-4 text-white" />}
                      >
                        <div className="bg-slate-50 hover:bg-slate-100/80 border border-slate-200 p-3 rounded-xl flex items-center justify-between text-xs transition-colors shadow-2xs">
                          <div className="flex items-center gap-3 min-w-0">
                            <img src={std.avatar} alt={std.name} className="w-9 h-9 rounded-full object-cover border border-slate-200 shrink-0" />
                            <div className="min-w-0">
                              <div className="font-bold text-slate-900 truncate">{std.name}</div>
                              <div className="text-[10px] text-slate-500 truncate mt-0.5">
                                {std.grade} • {std.schoolName} • حافلة: <span className="font-bold text-slate-700">{std.busNumber}</span> • مقعد: {std.seatNumber}
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => onDeleteStudent(std.id)}
                            className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition-colors shrink-0 mr-2"
                            title="حذف الطالب"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </SwipeableCard>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: BUSES */}
          {activeTab === 'buses' && (
            <div className="space-y-5">
              <form onSubmit={handleCreateBus} className="bg-white border border-slate-200/90 p-4 sm:p-5 rounded-2xl shadow-2xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                  <h4 className="font-bold text-xs sm:text-sm text-slate-900 flex items-center gap-2">
                    <Plus className="w-4 h-4 text-blue-600" />
                    <span>إضافة حافلة وسائق جديد</span>
                  </h4>
                  <span className="text-[10px] text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded-md border border-amber-100">
                    ربط بـ GPS Live
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1">اسم/رقم الحافلة:</label>
                    <input
                      type="text"
                      required
                      placeholder="مثال: حافلة 104"
                      value={busNumber}
                      onChange={(e) => setBusNumber(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">رقم اللوحة المرورية:</label>
                    <input
                      type="text"
                      required
                      placeholder="مثال: ط ع 999"
                      value={plateNumber}
                      onChange={(e) => setPlateNumber(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all font-medium font-sans"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">اسم السائق الكامل:</label>
                    <input
                      type="text"
                      required
                      placeholder="مثال: سالم المعمري"
                      value={driverName}
                      onChange={(e) => setDriverName(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">رقم جوال السائق:</label>
                    <input
                      type="text"
                      required
                      value={driverPhone}
                      onChange={(e) => setDriverPhone(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all font-medium font-sans dir-ltr text-right"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">سعة الحافلة (عدد المقاعد):</label>
                    <input
                      type="number"
                      value={capacity}
                      onChange={(e) => setCapacity(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all font-medium font-sans"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-5 py-2.5 rounded-xl text-xs flex items-center gap-2 shadow-sm transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    <span>حفظ وإضافة الحافلة</span>
                  </button>
                </div>
              </form>

              <div className="bg-white border border-slate-200/90 p-4 rounded-2xl shadow-2xs space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-bold text-xs text-slate-800">أسطول الحافلات الحالي ({filteredBuses.length}):</h4>
                  <div className="flex items-center gap-1.5 text-[10px] text-amber-800 bg-amber-50 px-2.5 py-1 rounded-xl border border-amber-200/80 font-bold">
                    <ArrowRightLeft className="w-3 h-3 text-amber-600" />
                    <span>إيماءة الجوال: اسحب بطاقة الحافلة لليسار للحذف 👈</span>
                  </div>
                </div>

                <div className="max-h-60 overflow-y-auto space-y-2.5 pr-1">
                  {filteredBuses.length === 0 ? (
                    <div className="text-center py-6 text-slate-400 text-xs">لا توجد حافلات مطابقة للبحث</div>
                  ) : (
                    filteredBuses.map((b) => (
                      <SwipeableCard
                        key={b.id}
                        onSwipeLeft={() => {
                          onDeleteBus(b.id);
                          showToast(`تم حذف (${b.busNumber}) عبر إيماءة التمرير`);
                        }}
                        onSwipeRight={() => {
                          showToast(`الاتصال بسائق الحافلة: ${b.driverName} (${b.driverPhone})`);
                        }}
                        leftActionLabel="حذف الحافلة"
                        leftActionColor="rose"
                        rightActionLabel="اتصال بالسائق"
                        rightActionColor="emerald"
                        rightActionIcon={<Phone className="w-4 h-4 text-white" />}
                      >
                        <div className="bg-slate-50 hover:bg-slate-100/80 border border-slate-200 p-3 rounded-xl flex items-center justify-between text-xs transition-colors shadow-2xs">
                          <div>
                            <div className="font-bold text-slate-900 flex items-center gap-2">
                              <span>{b.busNumber}</span>
                              <span className="text-[10px] text-slate-500 bg-slate-200/70 px-1.5 py-0.2 rounded font-sans">{b.plateNumber}</span>
                            </div>
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              السائق: <span className="font-bold text-slate-700">{b.driverName}</span> • الهاتف: {b.driverPhone} • السعة: {b.capacity} طالب
                            </div>
                          </div>
                          <button
                            onClick={() => onDeleteBus(b.id)}
                            className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition-colors shrink-0 mr-2"
                            title="حذف الحافلة"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </SwipeableCard>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: ROUTES */}
          {activeTab === 'routes' && (
            <div className="space-y-5">
              <form onSubmit={handleCreateRoute} className="bg-white border border-slate-200/90 p-4 sm:p-5 rounded-2xl shadow-2xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                  <h4 className="font-bold text-xs sm:text-sm text-slate-900 flex items-center gap-2">
                    <Plus className="w-4 h-4 text-blue-600" />
                    <span>إضافة مسار مدرسي جديد</span>
                  </h4>
                  <span className="text-[10px] text-purple-700 font-bold bg-purple-50 px-2 py-0.5 rounded-md border border-purple-100">
                    تحسين AI Gemini
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="sm:col-span-2">
                    <label className="block text-slate-700 font-bold mb-1">اسم المسار بالعربية:</label>
                    <input
                      type="text"
                      required
                      placeholder="مثال: مسار حطين - مدرسة المسار الدولية"
                      value={routeNameAr}
                      onChange={(e) => setRouteNameAr(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">المسافة التقديرية (كم):</label>
                    <input
                      type="text"
                      value={routeDistance}
                      onChange={(e) => setRouteDistance(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all font-medium font-sans"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">الزمن المتوقع (بالدقائق):</label>
                    <input
                      type="text"
                      value={routeDuration}
                      onChange={(e) => setRouteDuration(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all font-medium font-sans"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-5 py-2.5 rounded-xl text-xs flex items-center gap-2 shadow-sm transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    <span>حفظ وإنشاء المسار</span>
                  </button>
                </div>
              </form>

              <div className="bg-white border border-slate-200/90 p-4 rounded-2xl shadow-2xs space-y-3">
                <h4 className="font-bold text-xs text-slate-800">المسارات المسجلة حالياً ({filteredRoutes.length}):</h4>
                <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
                  {filteredRoutes.length === 0 ? (
                    <div className="text-center py-6 text-slate-400 text-xs">لا توجد مسارات مطابقة للبحث</div>
                  ) : (
                    filteredRoutes.map((r) => (
                      <div key={r.id} className="bg-slate-50 hover:bg-slate-100/80 border border-slate-200 p-3 rounded-xl flex items-center justify-between text-xs transition-colors">
                        <div>
                          <div className="font-bold text-slate-900">{r.routeNameAr}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            المسافة: {r.totalDistanceKm} كم • الوقت المقدر: {r.estimatedDurationMins} دقيقة • مؤشر الكفاءة الذكي: <span className="font-bold text-emerald-600">%{r.aiEfficiencyScore}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => onDeleteRoute(r.id)}
                          className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition-colors shrink-0 mr-2"
                          title="حذف المسار"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Fixed Modal Footer */}
        <div className="bg-slate-100/90 p-3.5 sm:p-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-2.5 shrink-0">
          <div className="text-[11px] text-slate-600 font-medium flex items-center gap-1.5 text-center sm:text-right">
            <Sparkles className="w-4 h-4 text-amber-500 shrink-0 hidden xs:inline" />
            <span>تتم مزامنة جميع البيانات فورياً عبر المحافظات والتطبيقات المربوطة</span>
          </div>
          <button
            onClick={onClose}
            className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white font-bold px-6 py-2.5 rounded-xl text-xs transition-colors shadow-sm"
          >
            إغلاق نافذة البيانات
          </button>
        </div>

      </div>
    </div>
  );
};
