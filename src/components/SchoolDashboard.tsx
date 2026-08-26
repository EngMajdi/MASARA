import React, { useEffect, useMemo, useState } from 'react';
import { School, Student, Bus, Route, EtaEstimateView, CurrentLocation } from '../types';
import { AuthUser } from './AuthModal';
import { MapView } from './MapView';
import { SchoolJourneyOperationsPanel } from './SchoolJourneyOperationsPanel';
import { CurrentLocationPanel } from './CurrentLocationPanel';
import { EtaPanel } from './EtaPanel';
import { EtaAccuracyPanel } from './EtaAccuracyPanel';
import { getFleetEta } from '../services/etaApi';
import { getFleetCurrentLocations } from '../services/currentLocationApi';
import { useGovernedBusNumbers } from '../services/governedBusResolver';
import { LiveRadar } from './live/LiveRadar';
import { DistributionAssistant } from './school/DistributionAssistant';
import { BusDetailSheet } from './school/BusDetailSheet';
import { Card, Metric, Badge, Tabs, MobileTabBar, EmptyState, Button } from './ui';
import type { TabItem, Tone } from './ui';
import { Bus as BusIcon, Users, Route as RouteIcon, AlertTriangle, CheckCircle2, Clock, Calendar, Search, Database, ShieldAlert, Home, ChevronDown, ChevronUp, Radar } from 'lucide-react';

/** Same real ETA-derived arrival status used by the Bus Arrival Radar list and the Bus Detail Sheet — never fabricated, a bus absent from the fleet ETA response genuinely has no tracked trip yet. */
function getArrivalInfo(bus: Bus, fleetEta: EtaEstimateView[], governedBusNumbers: Record<string, string>): { tone: Tone; label: string; etaMinutes: number | null } {
  const eta = fleetEta.find((e) => governedBusNumbers[e.busId] === bus.busNumber);
  if (!eta) return { tone: 'neutral', label: 'لم تبدأ الرحلة', etaMinutes: null };
  const etaMinutes = eta.estimatedArrivalAt ? Math.max(0, Math.round((new Date(eta.estimatedArrivalAt).getTime() - Date.now()) / 60000)) : null;
  if (eta.status === 'ON_TIME') return { tone: 'success', label: 'في الوقت المحدد', etaMinutes };
  if (eta.status === 'DELAYED') return { tone: 'warning', label: 'متأخرة', etaMinutes };
  if (eta.status === 'STALE') return { tone: 'neutral', label: 'بيانات قديمة', etaMinutes };
  return { tone: 'neutral', label: 'غير معروف', etaMinutes };
}

/** Bus occupancy threshold for a "near capacity" attention signal — kept in sync with DistributionAssistant.tsx's HIGH_OCCUPANCY. */
const NEAR_CAPACITY = 0.85;

interface AttentionItem {
  key: string;
  tone: Tone;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}

/** Real fleet ETA, polled — a bus absent from the response genuinely has no active tracked trip (never fabricated as "on time"). */
function useFleetEta(userEmail: string | undefined) {
  const [etas, setEtas] = useState<EtaEstimateView[]>([]);
  useEffect(() => {
    if (!userEmail) return;
    let cancelled = false;
    const load = () => getFleetEta(userEmail).then((data) => !cancelled && setEtas(data)).catch(() => !cancelled && setEtas([]));
    load();
    const interval = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [userEmail]);
  return etas;
}

/** Real fleet current-location projection, polled (docs/LIVE_TRACKING_ARCHITECTURE_AUDIT.md). */
function useFleetLocations(userEmail: string | undefined) {
  const [locations, setLocations] = useState<CurrentLocation[]>([]);
  useEffect(() => {
    if (!userEmail) return;
    let cancelled = false;
    const load = () => getFleetCurrentLocations(userEmail).then((data) => !cancelled && setLocations(data)).catch(() => !cancelled && setLocations([]));
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [userEmail]);
  return locations;
}

interface SchoolDashboardProps {
  schools: School[];
  students: Student[];
  buses: Bus[];
  routes: Route[];
  currentUser: AuthUser | null;
  onOpenDataManagement: () => void;
  onOpenApprovalCenter: () => void;
}

const SECTIONS: TabItem[] = [
  { id: 'today', label: 'اليوم', icon: <Home className="w-4 h-4" /> },
  { id: 'fleet', label: 'الأسطول', icon: <BusIcon className="w-4 h-4" /> },
  { id: 'students', label: 'الطلاب', icon: <Users className="w-4 h-4" /> },
  { id: 'routes', label: 'المسارات', icon: <RouteIcon className="w-4 h-4" /> }
];

const greeting = () => (new Date().getHours() < 12 ? 'صباح الخير' : 'مساء الخير');

/**
 * Phase 9B — a school operator thinks "today's transport → fleet →
 * students → routes → alerts", not "generic analytics dashboard". "اليوم"
 * now leads with what needs attention (derived from real fuel/safety
 * data — never a fabricated "delayed by 9 minutes" the dataset can't
 * actually support), then the rest is organized into dedicated sections
 * instead of one long scroll of stacked cards.
 */
export const SchoolDashboard: React.FC<SchoolDashboardProps> = ({ schools, students, buses, routes, currentUser, onOpenDataManagement, onOpenApprovalCenter }) => {
  const [section, setSection] = useState<'today' | 'fleet' | 'students' | 'routes'>('today');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGrade, setSelectedGrade] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'boarded' | 'waiting' | 'absent'>('all');
  const [selectedBusId, setSelectedBusId] = useState('bus-101');
  const [showGovernedDetail, setShowGovernedDetail] = useState(false);
  const [detailBusId, setDetailBusId] = useState<string | null>(null);
  const fleetEta = useFleetEta(currentUser?.email);
  const fleetLocations = useFleetLocations(currentUser?.email);
  // The telemetry/ETA services return GOVERNED bus UUIDs, which share no ID
  // with the legacy `Bus.id` this component otherwise works with — only
  // `busNumber` matches across both stores (see governedBusResolver.ts /
  // docs/LIVE_TRACKING_ARCHITECTURE_AUDIT.md's P0-2 note).
  const governedBusIds = useMemo(() => Array.from(new Set([...fleetEta.map((e) => e.busId), ...fleetLocations.map((l) => l.busId)])), [fleetEta, fleetLocations]);
  const governedBusNumbers = useGovernedBusNumbers(governedBusIds, currentUser?.email);

  const selectedSchool = schools[0];
  const schoolStudents = selectedSchool ? students.filter((s) => s.schoolId === selectedSchool.id) : [];

  const gradeOptions = useMemo(() => Array.from(new Set(schoolStudents.map((s) => s.grade))).sort(), [schoolStudents]);

  const filteredStudents = schoolStudents.filter((s) => {
    const driverName = buses.find((b) => b.busNumber === s.busNumber)?.driverName ?? '';
    const matchesSearch = s.name.includes(searchTerm) || s.busNumber.includes(searchTerm) || s.grade.includes(searchTerm) || driverName.includes(searchTerm);
    const matchesGrade = selectedGrade === 'all' || s.grade === selectedGrade;
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'boarded' && (s.status === 'boarded' || s.status === 'at_school')) ||
      (statusFilter === 'waiting' && (s.status === 'waiting' || s.status === 'at_home')) ||
      (statusFilter === 'absent' && s.status === 'absent');
    return matchesSearch && matchesGrade && matchesStatus;
  });

  const activeBuses = buses.filter((b) => b.status === 'en_route_pickup' || b.status === 'en_route_school');
  const boardedCount = schoolStudents.filter((s) => s.status === 'boarded' || s.status === 'at_school').length;
  const absentCount = schoolStudents.filter((s) => s.status === 'absent').length;

  // Consolidated Attention Required (spec §21) — every real signal the school
  // dashboard already has access to (fuel/safety, real ETA delays, real
  // near-capacity occupancy, real absences), merged into one prioritized
  // list instead of leaving delay/capacity signals buried in other tabs.
  const attentionItems: AttentionItem[] = useMemo(() => {
    const items: AttentionItem[] = [];
    buses.forEach((bus) => {
      const reasons: string[] = [];
      let tone: Tone = 'warning';
      if (bus.fuelLevel < 20) {
        reasons.push(`مستوى الوقود منخفض (${bus.fuelLevel}%)`);
        tone = 'danger';
      }
      if (bus.safetyScore < 70) {
        reasons.push(`مؤشر السلامة منخفض (${bus.safetyScore}%)`);
        tone = 'danger';
      }
      const arrival = getArrivalInfo(bus, fleetEta, governedBusNumbers);
      if (arrival.label === 'متأخرة') reasons.push('متأخرة عن الوصول المتوقع');
      const occupancyPct = bus.capacity > 0 ? bus.currentOccupancy / bus.capacity : 0;
      if (occupancyPct >= NEAR_CAPACITY) reasons.push(`قريبة من كامل السعة (${Math.round(occupancyPct * 100)}%)`);
      if (reasons.length > 0) {
        items.push({
          key: bus.id,
          tone,
          icon: tone === 'danger' ? <AlertTriangle className="w-4 h-4" /> : <Clock className="w-4 h-4" />,
          title: bus.busNumber,
          subtitle: reasons.join(' · '),
          onClick: () => setDetailBusId(bus.id)
        });
      }
    });
    if (absentCount > 0) {
      items.push({
        key: 'absent-students',
        tone: 'info',
        icon: <Calendar className="w-4 h-4" />,
        title: 'غياب اليوم',
        subtitle: `${absentCount} طالب غائب عن النقل اليوم`,
        onClick: () => {
          setSection('students');
          setStatusFilter('absent');
        }
      });
    }
    return items.sort((a, b) => (a.tone === 'danger' ? 0 : 1) - (b.tone === 'danger' ? 0 : 1));
  }, [buses, fleetEta, governedBusNumbers, absentCount]);

  const detailBus = buses.find((b) => b.id === detailBusId) ?? null;
  const detailArrival = detailBus ? getArrivalInfo(detailBus, fleetEta, governedBusNumbers) : null;
  const detailFreshness = detailBus
    ? fleetLocations.find((l) => governedBusNumbers[l.busId] === detailBus.busNumber)?.freshness ?? null
    : null;
  const detailStudentCount = detailBus ? schoolStudents.filter((s) => s.busNumber === detailBus.busNumber).length : 0;
  const detailRoute = detailBus ? routes.find((r) => r.id === detailBus.assignedRouteId) : undefined;

  if (!selectedSchool) {
    return (
      <div className="space-y-3">
        <Card><div className="h-28 animate-skeleton bg-slate-100 rounded-xl" /></Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{selectedSchool.nameAr}</h1>
          <p className="text-sm text-text-secondary mt-0.5">{greeting()} — نظرة على النقل اليوم</p>
        </div>
        <Button variant="secondary" size="sm" icon={<ShieldAlert className="w-4 h-4 text-danger" />} onClick={onOpenApprovalCenter}>
          الموافقات
        </Button>
      </div>

      <div className="hidden sm:flex">
        <Tabs items={SECTIONS} activeId={section} onChange={(id) => setSection(id as typeof section)} />
      </div>

      {section === 'today' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <Metric icon={<BusIcon />} tone="success" value={activeBuses.length} total={buses.length} label="حافلات نشطة" />
            <Metric icon={<CheckCircle2 />} tone="info" value={boardedCount} total={schoolStudents.length} label="وصلوا" />
            <Metric icon={<Calendar />} tone={absentCount > 0 ? 'warning' : 'neutral'} value={absentCount} label="غياب اليوم" />
            <Metric icon={<AlertTriangle />} tone={attentionItems.length > 0 ? 'danger' : 'neutral'} value={attentionItems.length} label="يحتاج انتباه" emphasize={attentionItems.length > 0} onClick={() => document.getElementById('attention-required')?.scrollIntoView({ behavior: 'smooth' })} />
          </div>

          {attentionItems.length > 0 && (
            <div id="attention-required">
              <h2 className="text-sm font-bold text-text-primary mb-2">يحتاج انتباه</h2>
              <div className="space-y-2">
                {attentionItems.map((item) => (
                  <Card key={item.key} padding="sm" className="flex items-center gap-3 cursor-pointer hover:border-border-strong transition-colors" onClick={item.onClick}>
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${item.tone === 'danger' ? 'bg-danger-soft text-danger' : item.tone === 'warning' ? 'bg-warning-soft text-amber-600' : 'bg-info-soft text-sky-600'}`}>
                      {item.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm text-text-primary">{item.title}</div>
                      <div className="text-xs text-text-secondary">{item.subtitle}</div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          <div>
            <h2 className="text-sm font-bold text-text-primary mb-2 flex items-center gap-1.5">
              <Radar className="w-4 h-4 text-primary" />
              رادار وصول الحافلات
            </h2>
            <div className="space-y-2">
              {buses.map((bus) => {
                const arrival = getArrivalInfo(bus, fleetEta, governedBusNumbers);
                return (
                  <Card key={bus.id} padding="sm" className="flex items-center justify-between gap-3 cursor-pointer hover:border-border-strong transition-colors" onClick={() => setDetailBusId(bus.id)}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-primary-soft text-primary flex items-center justify-center shrink-0">
                        <BusIcon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-sm text-text-primary truncate">{bus.busNumber} · {bus.driverName}</div>
                        <Badge tone={arrival.tone} className="mt-1">{arrival.label}</Badge>
                      </div>
                    </div>
                    {arrival.etaMinutes !== null && <span className="text-sm font-bold text-text-primary shrink-0">{arrival.etaMinutes} د</span>}
                  </Card>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {section === 'fleet' && (
        <div className="space-y-5">
          <LiveRadar
            mode="fleet"
            title="رادار الأسطول المباشر (GPS Live Radar)"
            defaultExpanded
            height={320}
            entries={fleetLocations.map((loc) => ({
              busId: loc.busId,
              busLabel: governedBusNumbers[loc.busId] ?? loc.busId.slice(0, 8),
              lat: loc.latitude,
              lng: loc.longitude,
              freshness: loc.freshness
            }))}
            destination={selectedSchool ? { lat: selectedSchool.location.lat, lng: selectedSchool.location.lng, name: selectedSchool.nameAr } : undefined}
          />

          <MapView buses={buses} schools={schools} students={students} routes={routes} selectedBusId={selectedBusId} onSelectBus={setSelectedBusId} isExpanded onToggleExpand={() => {}} />

          <div>
            <h2 className="text-sm font-bold text-text-primary mb-2">إدارة الحافلات</h2>
            <div className="space-y-2">
              {buses.map((bus) => {
                const status = { idle: 'في الموقف', en_route_pickup: 'في مسار الانطلاق', en_route_school: 'في الطريق للمدرسة', returning: 'في طريق العودة', maintenance: 'تحت الصيانة' }[bus.status];
                return (
                  <Card key={bus.id} padding="sm" className="flex items-center justify-between gap-3 cursor-pointer hover:border-border-strong transition-colors" onClick={() => setDetailBusId(bus.id)}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-primary-soft text-primary flex items-center justify-center shrink-0">
                        <BusIcon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-sm text-text-primary truncate">{bus.busNumber} · {bus.driverName}</div>
                        <div className="text-xs text-text-secondary">{status} · {bus.currentOccupancy}/{bus.capacity} طالب</div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>

          {currentUser?.email && (
            <div>
              <button onClick={() => setShowGovernedDetail((v) => !v)} className="w-full flex items-center justify-between text-sm font-bold text-text-secondary py-2">
                <span className="flex items-center gap-1.5">تفاصيل تشغيلية إضافية</span>
                {showGovernedDetail ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showGovernedDetail && (
                <div className="space-y-4 animate-fade-in">
                  <SchoolJourneyOperationsPanel userEmail={currentUser.email} />
                  <Card>
                    <h3 className="font-bold text-sm text-text-primary mb-3">مواقع الأسطول الحالية</h3>
                    <CurrentLocationPanel userEmail={currentUser.email} scope={{ type: 'fleet' }} />
                  </Card>
                  <Card>
                    <h3 className="font-bold text-sm text-text-primary mb-3">تقديرات وقت الوصول</h3>
                    <EtaPanel userEmail={currentUser.email} scope={{ type: 'fleet' }} />
                  </Card>
                  <Card>
                    <h3 className="font-bold text-sm text-text-primary mb-3">دقة تقديرات الوصول</h3>
                    <EtaAccuracyPanel userEmail={currentUser.email} />
                  </Card>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {section === 'students' && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-text-tertiary absolute right-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="بحث بالاسم أو الحافلة أو السائق..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full h-11 bg-white border border-border-default rounded-xl pr-10 pl-3 text-sm focus:outline-none focus:border-primary"
              />
            </div>
            <select value={selectedGrade} onChange={(e) => setSelectedGrade(e.target.value)} className="h-11 bg-white border border-border-default rounded-xl px-3 text-sm focus:outline-none focus:border-primary">
              <option value="all">كل الصفوف</option>
              {gradeOptions.map((grade) => (
                <option key={grade} value={grade}>{grade}</option>
              ))}
            </select>
            <Button variant="secondary" icon={<Database className="w-4 h-4" />} onClick={onOpenDataManagement}>
              إدارة البيانات
            </Button>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {(
              [
                { id: 'all', label: `الكل (${schoolStudents.length})` },
                { id: 'boarded', label: `على متن الحافلة (${schoolStudents.filter((s) => s.status === 'boarded' || s.status === 'at_school').length})` },
                { id: 'waiting', label: `ينتظرون (${schoolStudents.filter((s) => s.status === 'waiting' || s.status === 'at_home').length})` },
                { id: 'absent', label: `غائبون (${absentCount})` }
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${statusFilter === f.id ? 'bg-primary text-white border-primary-hover' : 'bg-white text-text-secondary border-border-default'}`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {filteredStudents.length === 0 ? (
            <EmptyState icon={<Users />} title="لا توجد نتائج مطابقة" />
          ) : (
            <div className="bg-white border border-border-default rounded-2xl overflow-hidden">
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead>
                    <tr className="bg-surface-sunken text-text-secondary border-b border-border-default">
                      <th className="p-3 font-bold">الطالب</th>
                      <th className="p-3 font-bold">الصف</th>
                      <th className="p-3 font-bold">الحافلة</th>
                      <th className="p-3 font-bold">المقعد</th>
                      <th className="p-3 font-bold">السائق</th>
                      <th className="p-3 font-bold">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {filteredStudents.map((std) => {
                      const driverBus = buses.find((b) => b.busNumber === std.busNumber);
                      const tone: Tone = std.status === 'absent' ? 'danger' : std.status === 'waiting' || std.status === 'at_home' ? 'warning' : 'success';
                      const label = std.status === 'absent' ? 'غائب' : std.status === 'waiting' ? 'ينتظر' : std.status === 'boarded' ? 'على متن الحافلة' : std.status === 'at_school' ? 'وصل' : 'في المنزل';
                      return (
                        <tr key={std.id} className="hover:bg-slate-50 transition-colors">
                          <td className="p-3">
                            <div className="flex items-center gap-2.5">
                              <img src={std.avatar} alt={std.name} className="w-8 h-8 rounded-full object-cover border border-border-default" />
                              <span className="font-bold text-text-primary">{std.name}</span>
                            </div>
                          </td>
                          <td className="p-3 text-text-secondary">{std.grade}</td>
                          <td className="p-3 font-bold text-primary">{std.busNumber}</td>
                          <td className="p-3 text-text-secondary">{std.seatNumber}</td>
                          <td className="p-3 text-text-secondary">{driverBus?.driverName ?? '—'}</td>
                          <td className="p-3"><Badge tone={tone}>{label}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="sm:hidden divide-y divide-border-default">
                {filteredStudents.map((std) => {
                  const driverBus = buses.find((b) => b.busNumber === std.busNumber);
                  const tone: Tone = std.status === 'absent' ? 'danger' : std.status === 'waiting' || std.status === 'at_home' ? 'warning' : 'success';
                  const label = std.status === 'absent' ? 'غائب' : std.status === 'waiting' ? 'ينتظر' : std.status === 'boarded' ? 'على متن الحافلة' : std.status === 'at_school' ? 'وصل' : 'في المنزل';
                  return (
                    <div key={std.id} className="p-3 flex items-center gap-3">
                      <img src={std.avatar} alt={std.name} className="w-10 h-10 rounded-lg object-cover border border-border-default shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm text-text-primary truncate">{std.name}</div>
                        <div className="text-xs text-text-secondary">{std.grade} · {std.busNumber} · مقعد {std.seatNumber} · {driverBus?.driverName ?? '—'}</div>
                      </div>
                      <Badge tone={tone}>{label}</Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <DistributionAssistant buses={buses} />
        </div>
      )}

      {section === 'routes' && (
        <div className="space-y-2">
          {routes.length === 0 ? (
            <EmptyState icon={<RouteIcon />} title="لا توجد مسارات بعد" action={<Button size="sm" onClick={onOpenDataManagement}>إضافة مسار</Button>} />
          ) : (
            routes.map((route) => (
              <Card key={route.id} padding="sm" className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold text-sm text-text-primary truncate">{route.routeNameAr}</div>
                  <div className="text-xs text-text-secondary">{route.totalDistanceKm} كم · {route.estimatedDurationMins} دقيقة</div>
                </div>
                <Badge tone="neutral">{route.stops.length} محطات</Badge>
              </Card>
            ))
          )}
        </div>
      )}

      <MobileTabBar items={SECTIONS} activeId={section} onChange={(id) => setSection(id as typeof section)} />

      <BusDetailSheet
        bus={detailBus}
        route={detailRoute}
        studentCount={detailStudentCount}
        etaMinutes={detailArrival?.etaMinutes ?? null}
        arrivalLabel={detailArrival?.label ?? 'لم تبدأ الرحلة'}
        arrivalTone={detailArrival?.tone ?? 'neutral'}
        locationFreshness={detailFreshness}
        onClose={() => setDetailBusId(null)}
        onViewStudents={() => {
          if (detailBus) setSearchTerm(detailBus.busNumber);
          setStatusFilter('all');
          setSection('students');
          setDetailBusId(null);
        }}
        onViewRoute={() => {
          setSection('routes');
          setDetailBusId(null);
        }}
      />
    </div>
  );
};
