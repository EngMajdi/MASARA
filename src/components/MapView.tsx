import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Bus, School, Student, Route } from '../types';
import {
  Play,
  Pause,
  Filter,
  Eye,
  EyeOff,
  Crosshair,
  ChevronDown,
  ChevronUp,
  Map,
  ShieldAlert,
  Users,
  Compass,
  Bus as BusIcon
} from 'lucide-react';

interface MapViewProps {
  buses: Bus[];
  schools: School[];
  students: Student[];
  routes: Route[];
  selectedBusId?: string;
  onSelectBus?: (busId: string) => void;
  onSelectStudent?: (studentId: string) => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export const MapView: React.FC<MapViewProps> = ({
  buses,
  schools,
  students,
  routes,
  selectedBusId,
  onSelectBus,
  onSelectStudent,
  isExpanded = true,
  onToggleExpand
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<{ [key: string]: L.Marker }>({});
  const polylineRef = useRef<L.Polyline | null>(null);

  // Map controls & layout settings
  const [mapHeightMode, setMapHeightMode] = useState<'compact' | 'standard' | 'large'>('standard');
  const [isSimulating, setIsSimulating] = useState(true);
  const [showTrafficLayer, setShowTrafficLayer] = useState(true);
  const [showBuses, setShowBuses] = useState(true);
  const [showSchools, setShowSchools] = useState(true);
  const [showStudents, setShowStudents] = useState(true);
  const [showLegend, setShowLegend] = useState(true);
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  const [busPositions, setBusPositions] = useState<{ [id: string]: { lat: number; lng: number } }>({
    'bus-101': { lat: buses[0]?.currentLocation?.lat || 23.5980, lng: buses[0]?.currentLocation?.lng || 58.4100 },
    'bus-102': { lat: buses[1]?.currentLocation?.lat || 23.6120, lng: buses[1]?.currentLocation?.lng || 58.2100 }
  });

  // Observe container size changes & update Leaflet map canvas
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    });

    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Trigger Leaflet map resize whenever height mode or expand state changes
  useEffect(() => {
    if (mapInstanceRef.current && isExpanded) {
      const timer = setTimeout(() => {
        mapInstanceRef.current?.invalidateSize();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [mapHeightMode, isExpanded]);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || !isExpanded) return;

    if (!mapInstanceRef.current) {
      // Muscat coordinates
      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: false
      }).setView([23.6000, 58.3800], 12);

      // Voyager light map tiles for clean, readable aesthetic
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd'
      }).addTo(map);

      // Add zoom controls
      L.control.zoom({ position: 'topleft' }).addTo(map);

      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [isExpanded]);

  // Update Markers & Polylines
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !isExpanded) return;

    // Clear previous markers
    (Object.values(markersRef.current) as L.Marker[]).forEach((m) => m.remove());
    markersRef.current = {};

    if (polylineRef.current) {
      polylineRef.current.remove();
      polylineRef.current = null;
    }

    // 1. School Markers
    if (showSchools) {
      schools.forEach((sch) => {
        const schoolIcon = L.divIcon({
          className: 'custom-school-pin',
          html: `
            <div class="relative group cursor-pointer">
              <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-600 to-amber-500 border-2 border-white shadow-md flex items-center justify-center text-white font-bold text-sm">
                🏫
              </div>
              <div class="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap bg-slate-900/90 text-amber-300 text-[10px] font-bold px-1.5 py-0.5 rounded border border-amber-500/30 shadow-xs">
                ${sch.nameAr}
              </div>
            </div>
          `,
          iconSize: [32, 32],
          iconAnchor: [16, 32]
        });

        const marker = L.marker([sch.location.lat, sch.location.lng], { icon: schoolIcon })
          .addTo(map)
          .bindPopup(`
            <div dir="rtl" class="p-2 font-['Tajawal'] text-slate-800">
              <h3 class="font-bold text-xs text-amber-800">${sch.nameAr}</h3>
              <p class="text-[11px] text-slate-600 mt-0.5">${sch.location.address}</p>
              <div class="mt-2 text-[11px] font-medium text-slate-700 bg-amber-50 p-1.5 rounded border border-amber-200">
                إجمالي الطلبة: ${sch.totalStudents} | الحافلات النشطة: ${sch.activeBusesCount}
              </div>
            </div>
          `);

        markersRef.current[`school-${sch.id}`] = marker;
      });
    }

    // 2. Student Pickup Points
    if (showStudents) {
      students.forEach((std) => {
        let badgeBg = 'bg-slate-700 text-slate-200';
        let iconSymbol = '📍';
        if (std.status === 'boarded') {
          badgeBg = 'bg-emerald-600 text-white';
          iconSymbol = '✅';
        } else if (std.status === 'waiting') {
          badgeBg = 'bg-amber-500 text-slate-950 font-bold';
          iconSymbol = '⏳';
        } else if (std.status === 'absent') {
          badgeBg = 'bg-rose-600 text-white';
          iconSymbol = '❌';
        }

        const studentIcon = L.divIcon({
          className: 'custom-student-pin',
          html: `
            <div class="relative group cursor-pointer">
              <div class="w-6 h-6 rounded-full border border-white shadow-md flex items-center justify-center text-[10px] ${badgeBg}">
                ${iconSymbol}
              </div>
            </div>
          `,
          iconSize: [24, 24],
          iconAnchor: [12, 24]
        });

        const marker = L.marker([std.pickupPoint.lat, std.pickupPoint.lng], { icon: studentIcon })
          .addTo(map)
          .on('click', () => onSelectStudent && onSelectStudent(std.id))
          .bindPopup(`
            <div dir="rtl" class="p-2 font-['Tajawal'] text-slate-800">
              <div class="flex items-center gap-2">
                <img src="${std.avatar}" class="w-7 h-7 rounded-full object-cover border" />
                <div>
                  <h4 class="font-bold text-xs">${std.name}</h4>
                  <p class="text-[10px] text-slate-500">${std.grade} • ${std.busNumber}</p>
                </div>
              </div>
              <div class="mt-1.5 text-[11px] text-slate-700">
                <strong>نقطة التجمع:</strong> ${std.pickupPoint.nameAr}<br/>
                <strong>الحالة:</strong> ${std.status === 'boarded' ? 'تم الصعود ✅' : std.status === 'waiting' ? 'ينتظر ⏳' : 'غائب ❌'}
              </div>
            </div>
          `);

        markersRef.current[`student-${std.id}`] = marker;
      });
    }

    // 3. Bus Markers
    if (showBuses) {
      buses.forEach((bus) => {
        const pos = busPositions[bus.id] || bus.currentLocation;
        const isSelected = bus.id === selectedBusId;

        const busIcon = L.divIcon({
          className: 'custom-bus-pin',
          html: `
            <div class="relative group cursor-pointer ${isSelected ? 'scale-110 z-30' : ''} transition-transform">
              <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 via-emerald-500 to-teal-500 border-2 border-white shadow-lg flex items-center justify-center text-white text-base">
                🚌
                <span class="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-300"></span>
                </span>
              </div>
              <div class="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap bg-slate-900 text-emerald-300 text-[9px] font-bold px-2 py-0.5 rounded border border-emerald-500/50 shadow flex items-center gap-1">
                <span>${bus.busNumber}</span>
                <span class="text-white bg-emerald-700 px-1 rounded">${bus.speedKmH} كم/س</span>
              </div>
            </div>
          `,
          iconSize: [40, 40],
          iconAnchor: [20, 40]
        });

        const marker = L.marker([pos.lat, pos.lng], { icon: busIcon })
          .addTo(map)
          .on('click', () => onSelectBus && onSelectBus(bus.id))
          .bindPopup(`
            <div dir="rtl" class="p-2 font-['Tajawal'] text-slate-800">
              <div class="flex items-center gap-2 border-b pb-1">
                <span class="text-lg">🚌</span>
                <div>
                  <h4 class="font-bold text-xs text-emerald-900">${bus.busNumber} (${bus.plateNumber})</h4>
                  <p class="text-[10px] text-slate-500">السائق: ${bus.driverName}</p>
                </div>
              </div>
              <div class="mt-1.5 text-[11px] space-y-0.5">
                <div><strong>الحمولة:</strong> ${bus.currentOccupancy} / ${bus.capacity} طالب</div>
                <div><strong>المحطة القادمة:</strong> ${bus.nextStopName}</div>
                <div><strong>الوقت المتوقع (ETA):</strong> ${bus.nextStopEtaMins} دقائق</div>
              </div>
            </div>
          `);

        markersRef.current[`bus-${bus.id}`] = marker;
      });
    }

    // 4. Polyline Route
    const activeRoute = routes.find((r) => r.busId === selectedBusId) || routes[0];
    if (activeRoute && activeRoute.waypoints.length > 0) {
      const latLngs = activeRoute.waypoints.map((wp) => [wp.lat, wp.lng] as [number, number]);

      const polyline = L.polyline(latLngs, {
        color: '#10b981',
        weight: 4,
        opacity: 0.85,
        dashArray: '6, 6',
        lineCap: 'round'
      }).addTo(map);

      polylineRef.current = polyline;
    }
  }, [buses, schools, students, routes, selectedBusId, busPositions, showBuses, showSchools, showStudents, isExpanded]);

  // Simulation Loop
  useEffect(() => {
    if (!isSimulating || !isExpanded) return;

    const interval = setInterval(() => {
      setBusPositions((prev) => {
        const cur101 = prev['bus-101'] || { lat: 23.5980, lng: 58.4100 };
        const targetLat = 23.6100;
        const targetLng = 58.4200;

        const nextLat = cur101.lat + (targetLat - cur101.lat) * 0.02;
        const nextLng = cur101.lng + (targetLng - cur101.lng) * 0.02;

        return {
          ...prev,
          'bus-101': { lat: nextLat, lng: nextLng }
        };
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [isSimulating, isExpanded]);

  // Fit Bounds
  const handleFitAllBounds = () => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const latLngs: [number, number][] = [];

    buses.forEach((b) => {
      const pos = busPositions[b.id] || b.currentLocation;
      if (pos) latLngs.push([pos.lat, pos.lng]);
    });

    schools.forEach((s) => {
      if (s.location) latLngs.push([s.location.lat, s.location.lng]);
    });

    students.forEach((st) => {
      if (st.pickupPoint) latLngs.push([st.pickupPoint.lat, st.pickupPoint.lng]);
    });

    if (latLngs.length > 0) {
      const bounds = L.latLngBounds(latLngs);
      map.fitBounds(bounds, { padding: [35, 35], maxZoom: 15, animate: true, duration: 1.0 });
    }
  };

  // Center on Bus
  const centerOnBus = (busId: string) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const pos = busPositions[busId] || buses.find((b) => b.id === busId)?.currentLocation;
    if (pos) {
      map.flyTo([pos.lat, pos.lng], 15, { duration: 1.0 });
    }
  };

  // Height class mapping for clean responsive proportion
  const heightClassName =
    mapHeightMode === 'compact'
      ? 'h-[260px] sm:h-[310px]'
      : mapHeightMode === 'standard'
      ? 'h-[360px] sm:h-[420px]'
      : 'h-[480px] sm:h-[560px]';

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-3.5 sm:p-5 space-y-3.5 shadow-sm">
      {/* Integrated Header Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 sm:p-2.5 bg-blue-50 text-blue-700 rounded-xl border border-blue-200/80 shrink-0 shadow-2xs">
            <Map className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-bold text-slate-900">
                الخريطة المباشرة وتتبع الحافلات والطلاب (GPS Live Radar)
              </h2>
              <span className="bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-md border border-emerald-200/80 shrink-0 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>تحديث حي</span>
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">
              متابعة متزامنة للحافلات، نقاط الصعود، والتنبيهات المرورية بمسقط
            </p>
          </div>
        </div>

        {/* Header Action Controls */}
        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          {/* Collapse/Expand Toggle */}
          {onToggleExpand && (
            <button
              onClick={onToggleExpand}
              className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200/80 text-slate-700 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors border border-slate-200"
            >
              {isExpanded ? (
                <>
                  <span>طي الخريطة</span>
                  <ChevronUp className="w-4 h-4 text-slate-500" />
                </>
              ) : (
                <>
                  <span>توسيع الخريطة</span>
                  <ChevronDown className="w-4 h-4 text-slate-500" />
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Map Content Body (Rendered when expanded) */}
      {isExpanded && (
        <div className="space-y-3">
          {/* Map Container Frame */}
          <div className={`relative w-full ${heightClassName} rounded-xl overflow-hidden border border-slate-200/90 shadow-2xs bg-slate-100 transition-all duration-300`}>
            {/* Leaflet DOM container */}
            <div ref={mapContainerRef} className="w-full h-full z-0" />

            {/* Light-themed Controls Toolbar Floating Header */}
            <div className="absolute top-2.5 right-2.5 left-2.5 z-20 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
              {/* Right Side: Focus & Action Dropdown */}
              <div className="flex items-center gap-1.5 pointer-events-auto bg-white/95 backdrop-blur-md p-1.5 rounded-xl border border-slate-200 shadow-md">
                <select
                  value={selectedBusId || 'fit'}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'fit') {
                      handleFitAllBounds();
                    } else if (val === 'school') {
                      if (schools[0]) mapInstanceRef.current?.flyTo([schools[0].location.lat, schools[0].location.lng], 14);
                    } else {
                      if (onSelectBus) onSelectBus(val);
                      centerOnBus(val);
                    }
                  }}
                  className="bg-slate-50 hover:bg-slate-100 text-slate-800 text-[11px] font-bold px-2.5 py-1 rounded-lg border border-slate-200 focus:outline-none cursor-pointer"
                >
                  <option value="fit">🎯 احتواء كافة العناصر</option>
                  <option value="school">🏫 مركز المدرسة</option>
                  {buses.map((b) => (
                    <option key={b.id} value={b.id}>
                      🚌 {b.busNumber} ({b.driverName})
                    </option>
                  ))}
                </select>

                <button
                  onClick={handleFitAllBounds}
                  title="إعادة ضبط العرض لاحتواء كافة النقاط"
                  className="p-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold transition-colors border border-slate-200 flex items-center gap-1"
                >
                  <Crosshair className="w-3.5 h-3.5 text-blue-600" />
                  <span className="hidden md:inline">احتواء</span>
                </button>

                <button
                  onClick={() => setIsSimulating(!isSimulating)}
                  title={isSimulating ? 'توقف الحركة' : 'تشغيل الحركة'}
                  className={`p-1.5 rounded-lg text-xs font-bold transition-colors border flex items-center gap-1 ${
                    isSimulating
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-500 shadow-2xs'
                      : 'bg-slate-50 text-slate-700 border-slate-200'
                  }`}
                >
                  {isSimulating ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  <span className="hidden md:inline">{isSimulating ? 'مباشر 🟢' : 'متوقف'}</span>
                </button>
              </div>

              {/* Left Side: Map Height Selector & Filters */}
              <div className="flex items-center gap-1.5 pointer-events-auto bg-white/95 backdrop-blur-md p-1.5 rounded-xl border border-slate-200 shadow-md">
                {/* Filter Menu Toggle */}
                <div className="relative">
                  <button
                    onClick={() => setShowFilterMenu(!showFilterMenu)}
                    className={`p-1.5 rounded-lg text-xs font-bold transition-colors border flex items-center gap-1 ${
                      showFilterMenu
                        ? 'bg-blue-600 text-white border-blue-500'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <Filter className="w-3.5 h-3.5 text-blue-600" />
                    <span className="hidden sm:inline">التصفية</span>
                  </button>

                  {/* Filter Dropdown Popup */}
                  {showFilterMenu && (
                    <div className="absolute left-0 mt-2 w-48 bg-white border border-slate-200 rounded-xl shadow-xl p-2.5 z-50 text-xs space-y-2 text-slate-800 font-medium">
                      <div className="font-bold text-[11px] text-slate-500 border-b border-slate-100 pb-1">
                        إظهار / إخفاء العناصر:
                      </div>
                      <label className="flex items-center justify-between cursor-pointer hover:bg-slate-50 p-1 rounded">
                        <span>🚌 الحافلات المدرسية</span>
                        <input
                          type="checkbox"
                          checked={showBuses}
                          onChange={(e) => setShowBuses(e.target.checked)}
                          className="rounded accent-emerald-600"
                        />
                      </label>
                      <label className="flex items-center justify-between cursor-pointer hover:bg-slate-50 p-1 rounded">
                        <span>🏫 المدرسة</span>
                        <input
                          type="checkbox"
                          checked={showSchools}
                          onChange={(e) => setShowSchools(e.target.checked)}
                          className="rounded accent-amber-600"
                        />
                      </label>
                      <label className="flex items-center justify-between cursor-pointer hover:bg-slate-50 p-1 rounded">
                        <span>📍 نقاط الطلاب</span>
                        <input
                          type="checkbox"
                          checked={showStudents}
                          onChange={(e) => setShowStudents(e.target.checked)}
                          className="rounded accent-blue-600"
                        />
                      </label>
                      <label className="flex items-center justify-between cursor-pointer hover:bg-slate-50 p-1 rounded">
                        <span>🚗 شريط الازدحام</span>
                        <input
                          type="checkbox"
                          checked={showTrafficLayer}
                          onChange={(e) => setShowTrafficLayer(e.target.checked)}
                          className="rounded accent-amber-600"
                        />
                      </label>
                    </div>
                  )}
                </div>

                {/* Map Height Size Buttons */}
                <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-[10px] font-bold">
                  <button
                    onClick={() => setMapHeightMode('compact')}
                    className={`px-2 py-1 rounded-md transition-colors ${
                      mapHeightMode === 'compact'
                        ? 'bg-blue-600 text-white shadow-2xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    مدمج
                  </button>
                  <button
                    onClick={() => setMapHeightMode('standard')}
                    className={`px-2 py-1 rounded-md transition-colors ${
                      mapHeightMode === 'standard'
                        ? 'bg-blue-600 text-white shadow-2xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    قياسي
                  </button>
                  <button
                    onClick={() => setMapHeightMode('large')}
                    className={`px-2 py-1 rounded-md transition-colors ${
                      mapHeightMode === 'large'
                        ? 'bg-blue-600 text-white shadow-2xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    كبير
                  </button>
                </div>

                {/* Legend Toggle */}
                <button
                  onClick={() => setShowLegend(!showLegend)}
                  title="إظهار/إخفاء المفتاح"
                  className="p-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200"
                >
                  {showLegend ? <EyeOff className="w-3.5 h-3.5 text-slate-600" /> : <Eye className="w-3.5 h-3.5 text-slate-600" />}
                </button>
              </div>
            </div>

            {/* Collapsible Legend Overlay */}
            {showLegend && (
              <div className="absolute bottom-2.5 right-2.5 left-2.5 z-20 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-xl p-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-700 shadow-sm">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1 font-medium">
                    <span className="w-2.5 h-2.5 rounded bg-amber-500 inline-block"></span>
                    <span>المدرسة</span>
                  </div>
                  <div className="flex items-center gap-1 font-medium">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
                    <span>حافلة حية</span>
                  </div>
                  <div className="flex items-center gap-1 font-medium">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block"></span>
                    <span>تم الصعود ✅</span>
                  </div>
                  <div className="flex items-center gap-1 font-medium">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block"></span>
                    <span>ينتظر ⏳</span>
                  </div>
                  <div className="flex items-center gap-1 font-medium">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block"></span>
                    <span>غائب ❌</span>
                  </div>
                </div>

                {showTrafficLayer && (
                  <div className="flex items-center gap-1 text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded text-[10px] font-medium">
                    <ShieldAlert className="w-3 h-3 text-amber-600 shrink-0" />
                    <span>حركة مرورية انسيابية بمسقط</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
