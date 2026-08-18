import React, { useState } from 'react';
import { School, Student, Bus } from '../types';
import { AuthUser } from './AuthModal';
import { SchoolJourneyOperationsPanel } from './SchoolJourneyOperationsPanel';
import { CurrentLocationPanel } from './CurrentLocationPanel';
import { EtaPanel } from './EtaPanel';
import {
  Building2,
  Users,
  Bus as BusIcon,
  CheckCircle2,
  Clock,
  Search,
  ShieldCheck,
  Calendar
} from 'lucide-react';

interface SchoolDashboardProps {
  schools: School[];
  students: Student[];
  buses: Bus[];
  currentUser: AuthUser | null;
}

export const SchoolDashboard: React.FC<SchoolDashboardProps> = ({
  schools,
  students,
  buses,
  currentUser
}) => {
  const selectedSchool = schools[0];
  const schoolStudents = selectedSchool ? students.filter((s) => s.schoolId === selectedSchool.id) : [];
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGrade, setSelectedGrade] = useState('all');

  if (!selectedSchool) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-500 font-medium">
        جاري تحميل بيانات المدرسة...
      </div>
    );
  }

  const filteredStudents = schoolStudents.filter((s) => {
    const matchesSearch =
      s.name.includes(searchTerm) || s.busNumber.includes(searchTerm) || s.grade.includes(searchTerm);
    const matchesGrade = selectedGrade === 'all' || s.grade === selectedGrade;
    return matchesSearch && matchesGrade;
  });

  const boardedCount = schoolStudents.filter((s) => s.status === 'boarded').length;
  const absentCount = schoolStudents.filter((s) => s.status === 'absent').length;
  const arrivalPercentage = Math.round((boardedCount / (schoolStudents.length || 1)) * 100);

  return (
    <div className="space-y-6">
      {/* School Header Banner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-wrap items-center justify-between gap-4 shadow-sm text-slate-900">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-blue-600 border border-blue-500 flex items-center justify-center text-white text-3xl shadow-sm">
            🏫
          </div>
          <div>
            <div className="text-xs font-bold text-blue-600 flex items-center gap-1.5 mb-0.5">
              <Building2 className="w-3.5 h-3.5" />
              <span>لوحة تحكم إدارة المدرسة - مَسارَا</span>
            </div>
            <h2 className="text-2xl font-bold text-slate-900">{selectedSchool.nameAr}</h2>
            <p className="text-xs text-slate-500">{selectedSchool.location.address}</p>
          </div>
        </div>

        {/* Quick Arrival Metrics */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-center min-w-[110px]">
            <div className="text-[10px] text-slate-500 font-semibold">إجمالي الطلبة</div>
            <div className="text-lg font-black text-slate-900">{schoolStudents.length}</div>
          </div>

          <div className="bg-slate-50 p-3.5 rounded-xl border border-emerald-200 text-center min-w-[110px]">
            <div className="text-[10px] text-emerald-700 font-semibold">تم الصعود والوصول</div>
            <div className="text-lg font-black text-emerald-800">{boardedCount}</div>
          </div>

          <div className="bg-slate-50 p-3.5 rounded-xl border border-rose-200 text-center min-w-[110px]">
            <div className="text-[10px] text-rose-700 font-semibold">مسجلو الغياب اليوم</div>
            <div className="text-lg font-black text-rose-800">{absentCount}</div>
          </div>

          <div className="bg-slate-50 p-3.5 rounded-xl border border-amber-200 text-center min-w-[120px]">
            <div className="text-[10px] text-amber-800 font-semibold">نسبة الاكتفاء والوصول</div>
            <div className="text-lg font-black text-amber-900">{arrivalPercentage}%</div>
          </div>
        </div>
      </div>

      {/* Grid: Bus Fleet Arrival Radar & Student Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Bus Arrival Radar */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm text-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
              <BusIcon className="w-4 h-4 text-blue-600" />
              <span>رادار وصول حافلات المدرسة</span>
            </h3>
            <span className="text-[10px] text-slate-500 font-mono">محدث لحظياً</span>
          </div>

          <div className="space-y-3">
            {buses.map((bus) => (
              <div
                key={bus.id}
                className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <div className="font-bold text-slate-900 flex items-center gap-2">
                    <span>🚌 {bus.busNumber}</span>
                    <span className="text-[10px] text-slate-500">({bus.driverName})</span>
                  </div>
                  <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded">
                    ETA {bus.nextStopEtaMins} د
                  </span>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-600">
                  <span>الحمولة: {bus.currentOccupancy}/{bus.capacity}</span>
                  <span>السرعة: {bus.speedKmH} كم/س</span>
                  <span className="text-emerald-700 font-bold">الأمان: {bus.safetyScore}%</span>
                </div>

                {/* Progress Mini Bar */}
                <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-600 to-emerald-500 rounded-full"
                    style={{ width: `${Math.min(100, (bus.currentOccupancy / bus.capacity) * 100)}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-xl text-xs text-emerald-800 space-y-1">
            <div className="font-bold flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>تقارير الانضباط والمواصفات</span>
            </div>
            <p className="text-[11px] text-emerald-700 font-medium leading-relaxed">
              جميع السائقين ممتثلون لقوانين السرعة المحددة عند بوابة المدرسة (20 كم/س).
            </p>
          </div>
        </div>

        {/* Student Attendance Matrix */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm text-slate-900">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-600" />
                <span>جدول مصفوفة حضور وحافلات الطلاب</span>
              </h3>
              <p className="text-xs text-slate-500">متابعة حالة كل طالب ورقم مقعده والحافلة المسندة</p>
            </div>

            {/* Filter controls */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="بحث باسم الطالب أو الحافلة..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl pr-8 pl-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500 w-44"
                />
              </div>

              <select
                value={selectedGrade}
                onChange={(e) => setSelectedGrade(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
              >
                <option value="all">جميع الصفوف الدراسية</option>
                <option value="الصف الخامس الابتدائي">الصف الخامس</option>
                <option value="الصف الثاني الابتدائي">الصف الثاني</option>
                <option value="الصف السادس الابتدائي">الصف السادس</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-700 border-b border-slate-200">
                  <th className="p-3 font-bold">الطالب</th>
                  <th className="p-3 font-bold">الصف الدراسي</th>
                  <th className="p-3 font-bold">الحافلة ورقم المقعد</th>
                  <th className="p-3 font-bold">ولي الأمر</th>
                  <th className="p-3 font-bold">حالة النقل اليوم</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredStudents.map((std) => (
                  <tr key={std.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3">
                      <div className="flex items-center gap-2.5">
                        <img src={std.avatar} alt={std.name} className="w-7 h-7 rounded-full object-cover border border-slate-200" />
                        <span className="font-bold text-slate-900">{std.name}</span>
                      </div>
                    </td>

                    <td className="p-3 text-slate-600 font-medium">{std.grade}</td>

                    <td className="p-3">
                      <div className="font-bold text-blue-700 font-mono">{std.busNumber}</div>
                      <div className="text-[10px] text-slate-500">مقعد: {std.seatNumber}</div>
                    </td>

                    <td className="p-3">
                      <div className="text-slate-800 font-medium">{std.parentName}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{std.parentPhone}</div>
                    </td>

                    <td className="p-3">
                      {std.status === 'boarded' && (
                        <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold px-2.5 py-1 rounded-full inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>صعد ({std.pickupTimeActual})</span>
                        </span>
                      )}
                      {std.status === 'waiting' && (
                        <span className="bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold px-2.5 py-1 rounded-full inline-flex items-center gap-1">
                          <Clock className="w-3 h-3 text-amber-600" />
                          <span>ينتظر الصعود</span>
                        </span>
                      )}
                      {std.status === 'absent' && (
                        <span className="bg-rose-50 text-rose-800 border border-rose-200 text-[10px] font-bold px-2.5 py-1 rounded-full inline-flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-rose-600" />
                          <span>مسجل غائب</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Journey Core operations (Phase 3B) — real backend-derived Journey state, not legacy status */}
      {currentUser?.email ? (
        <SchoolJourneyOperationsPanel userEmail={currentUser.email} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-slate-500 text-xs font-medium">
          سجّل الدخول لعرض عمليات الرحلات الطلابية المباشرة.
        </div>
      )}

      {/* Current Location Projection (Phase 4C) — derived read model over telemetry history, not raw GPS points */}
      {currentUser?.email && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
            <BusIcon className="w-4 h-4 text-blue-600" />
            <span>المواقع الحالية للأسطول (Current Location)</span>
          </h3>
          <CurrentLocationPanel userEmail={currentUser.email} scope={{ type: 'fleet' }} />
        </div>
      )}

      {/* ETA Intelligence (Phase 4D) — deterministic, explainable estimates over the current-location projection + route geometry */}
      {currentUser?.email && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-600" />
            <span>تقديرات وقت الوصول (ETA Intelligence)</span>
          </h3>
          <EtaPanel userEmail={currentUser.email} scope={{ type: 'fleet' }} />
        </div>
      )}
    </div>
  );
};
