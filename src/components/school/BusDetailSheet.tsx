import React from 'react';
import { Bus, Route } from '../../types';
import { Sheet, Badge, Button } from '../ui';
import type { Tone } from '../ui';
import { LiveStatusBadge, Freshness } from '../live/LiveStatusBadge';
import { Users, Route as RouteIcon, Fuel, ShieldCheck, AlertTriangle, Phone } from 'lucide-react';

interface BusDetailSheetProps {
  bus: Bus | null;
  route: Route | undefined;
  studentCount: number;
  etaMinutes: number | null;
  arrivalLabel: string;
  arrivalTone: Tone;
  locationFreshness: Freshness | null;
  onClose: () => void;
  onViewStudents: () => void;
  onViewRoute: () => void;
}

const STATUS_LABELS: Record<Bus['status'], { label: string; tone: Tone }> = {
  idle: { label: 'في الموقف', tone: 'neutral' },
  en_route_pickup: { label: 'في مسار الانطلاق', tone: 'info' },
  en_route_school: { label: 'في الطريق للمدرسة', tone: 'success' },
  returning: { label: 'في طريق العودة', tone: 'info' },
  maintenance: { label: 'تحت الصيانة', tone: 'danger' }
};

/** Bus Management detail view (spec §14/§32) — one drawer instead of navigating away for every bus lookup. Every field is a real value already flowing through the app; nothing here is invented. */
export const BusDetailSheet: React.FC<BusDetailSheetProps> = ({
  bus,
  route,
  studentCount,
  etaMinutes,
  arrivalLabel,
  arrivalTone,
  locationFreshness,
  onClose,
  onViewStudents,
  onViewRoute
}) => {
  if (!bus) return null;
  const status = STATUS_LABELS[bus.status];
  const occupancyPct = bus.capacity > 0 ? Math.round((bus.currentOccupancy / bus.capacity) * 100) : 0;
  const needsAttention = bus.fuelLevel < 20 || bus.safetyScore < 70 || occupancyPct >= 90;

  return (
    <Sheet
      isOpen={!!bus}
      onClose={onClose}
      title={bus.busNumber}
      subtitle={bus.plateNumber}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onViewStudents} icon={<Users className="w-4 h-4" />}>عرض الطلاب</Button>
          <Button variant="secondary" onClick={onViewRoute} icon={<RouteIcon className="w-4 h-4" />}>عرض المسار</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Badge tone={status.tone}>{status.label}</Badge>
          <Badge tone={arrivalTone}>{arrivalLabel}</Badge>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-surface-sunken border border-border-default rounded-xl p-3.5">
            <div className="text-xs text-text-secondary">السائق</div>
            <div className="font-bold text-sm text-text-primary mt-0.5">{bus.driverName}</div>
            <a href={`tel:${bus.driverPhone}`} className="text-xs text-primary font-bold flex items-center gap-1 mt-1">
              <Phone className="w-3 h-3" />
              {bus.driverPhone}
            </a>
          </div>
          <div className="bg-surface-sunken border border-border-default rounded-xl p-3.5">
            <div className="text-xs text-text-secondary">المسار</div>
            <div className="font-bold text-sm text-text-primary mt-0.5">{route?.routeNameAr ?? '—'}</div>
          </div>
          <div className="bg-surface-sunken border border-border-default rounded-xl p-3.5">
            <div className="text-xs text-text-secondary">الطلاب</div>
            <div className="font-bold text-sm text-text-primary mt-0.5">{studentCount} / {bus.capacity}</div>
          </div>
          <div className="bg-surface-sunken border border-border-default rounded-xl p-3.5">
            <div className="text-xs text-text-secondary">الوقت المتوقع للوصول</div>
            <div className="font-bold text-sm text-text-primary mt-0.5">{etaMinutes !== null ? `${etaMinutes} دقيقة` : '—'}</div>
          </div>
        </div>

        <div>
          <div className="text-xs text-text-secondary mb-1.5">GPS</div>
          <LiveStatusBadge freshness={locationFreshness} />
        </div>

        <div className="border-t border-border-default pt-3">
          <div className="text-xs font-bold text-text-secondary mb-2">الانتباه</div>
          {!needsAttention ? (
            <div className="flex items-center gap-2 text-sm text-emerald-700">
              <ShieldCheck className="w-4 h-4" />
              لا يوجد
            </div>
          ) : (
            <div className="space-y-1.5">
              {bus.fuelLevel < 20 && (
                <div className="flex items-center gap-2 text-sm text-rose-700">
                  <Fuel className="w-4 h-4" /> مستوى الوقود منخفض ({bus.fuelLevel}%)
                </div>
              )}
              {bus.safetyScore < 70 && (
                <div className="flex items-center gap-2 text-sm text-rose-700">
                  <AlertTriangle className="w-4 h-4" /> مؤشر السلامة منخفض ({bus.safetyScore}%)
                </div>
              )}
              {occupancyPct >= 90 && (
                <div className="flex items-center gap-2 text-sm text-amber-700">
                  <Users className="w-4 h-4" /> الحافلة تقترب من كامل السعة ({occupancyPct}%)
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
};
