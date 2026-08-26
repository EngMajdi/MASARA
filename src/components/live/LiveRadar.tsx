import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { ChevronDown, ChevronUp, Radio, Crosshair } from 'lucide-react';
import { LiveStatusBadge, Freshness } from './LiveStatusBadge';
import { EmptyState } from '../ui';

export interface RadarPosition {
  lat: number;
  lng: number;
  speedKmh?: number | null;
  heading?: number | null;
  freshness: Freshness;
  receivedAt: string;
}

export interface RadarStop {
  id: string;
  lat: number;
  lng: number;
  name: string;
  completed?: boolean;
}

export interface FleetRadarEntry {
  busId: string;
  busLabel: string;
  lat: number;
  lng: number;
  freshness: Freshness;
}

interface SingleModeProps {
  mode: 'single';
  position: RadarPosition | null;
  busLabel: string;
  stops?: RadarStop[];
  destination?: { lat: number; lng: number; name: string };
}

interface FleetModeProps {
  mode: 'fleet';
  entries: FleetRadarEntry[];
  destination?: { lat: number; lng: number; name: string };
}

type LiveRadarProps = (SingleModeProps | FleetModeProps) & {
  title?: string;
  defaultExpanded?: boolean;
  height?: number;
};

/**
 * GPS Live Radar — the one reusable live-tracking map for MASARA (Parent
 * child journey, Driver own bus, School/Admin fleet). Renders ONLY real
 * data passed in via props: a null/missing position renders an honest
 * empty state, never a fabricated pin. No client-side movement animation
 * is ever applied here — if the marker moves, it is because the caller
 * re-rendered with a new real position from a poll (see
 * docs/LIVE_TRACKING_ARCHITECTURE_AUDIT.md).
 */
export const LiveRadar: React.FC<LiveRadarProps> = (props) => {
  const { title = 'الموقع المباشر', defaultExpanded = false, height = 260 } = props;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);

  const hasData = props.mode === 'single' ? !!props.position : props.entries.length > 0;

  useEffect(() => {
    if (!expanded || !mapContainerRef.current || mapInstanceRef.current) return;
    const map = L.map(mapContainerRef.current, { zoomControl: false, attributionControl: false }).setView([23.6, 58.38], 12);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 19, subdomains: 'abcd' }).addTo(map);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    mapInstanceRef.current = map;
    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [expanded]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !expanded) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const bounds: [number, number][] = [];

    if (props.mode === 'single') {
      if (props.stops) {
        props.stops.forEach((stop) => {
          const icon = L.divIcon({
            className: '',
            html: `<div class="w-3 h-3 rounded-full border-2 border-white shadow ${stop.completed ? 'bg-emerald-500' : 'bg-slate-400'}"></div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6]
          });
          const marker = L.marker([stop.lat, stop.lng], { icon }).addTo(map).bindPopup(stop.name);
          markersRef.current.push(marker);
          bounds.push([stop.lat, stop.lng]);
        });
      }
      if (props.destination) {
        const icon = L.divIcon({
          className: '',
          html: `<div class="w-8 h-8 rounded-xl bg-amber-500 border-2 border-white shadow-md flex items-center justify-center text-white text-sm">🏫</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 32]
        });
        const marker = L.marker([props.destination.lat, props.destination.lng], { icon }).addTo(map).bindPopup(props.destination.name);
        markersRef.current.push(marker);
        bounds.push([props.destination.lat, props.destination.lng]);
      }
      if (props.position) {
        const icon = L.divIcon({
          className: '',
          html: `<div class="relative"><div class="w-10 h-10 rounded-xl bg-blue-600 border-2 border-white shadow-lg flex items-center justify-center text-white text-base">🚌</div>${
            props.position.freshness === 'FRESH' ? '<span class="absolute -top-1 -right-1 flex h-3 w-3"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span class="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border border-white"></span></span>' : ''
          }</div>`,
          iconSize: [40, 40],
          iconAnchor: [20, 40]
        });
        const marker = L.marker([props.position.lat, props.position.lng], { icon }).addTo(map).bindPopup(props.busLabel);
        markersRef.current.push(marker);
        bounds.push([props.position.lat, props.position.lng]);
      }
    } else {
      props.entries.forEach((entry) => {
        const icon = L.divIcon({
          className: '',
          html: `<div class="relative"><div class="w-9 h-9 rounded-xl ${entry.freshness === 'FRESH' ? 'bg-blue-600' : 'bg-slate-400'} border-2 border-white shadow-md flex items-center justify-center text-white text-sm">🚌</div><div class="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap bg-slate-900 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">${entry.busLabel}</div></div>`,
          iconSize: [36, 36],
          iconAnchor: [18, 36]
        });
        const marker = L.marker([entry.lat, entry.lng], { icon }).addTo(map).bindPopup(entry.busLabel);
        markersRef.current.push(marker);
        bounds.push([entry.lat, entry.lng]);
      });
      if (props.destination) {
        const icon = L.divIcon({
          className: '',
          html: `<div class="w-8 h-8 rounded-xl bg-amber-500 border-2 border-white shadow-md flex items-center justify-center text-white text-sm">🏫</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 32]
        });
        const marker = L.marker([props.destination.lat, props.destination.lng], { icon }).addTo(map).bindPopup(props.destination.name);
        markersRef.current.push(marker);
        bounds.push([props.destination.lat, props.destination.lng]);
      }
    }

    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], maxZoom: 15 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, props]);

  const recenter = () => {
    const map = mapInstanceRef.current;
    if (!map || markersRef.current.length === 0) return;
    map.fitBounds(L.latLngBounds(markersRef.current.map((m) => m.getLatLng())), { padding: [30, 30], maxZoom: 15 });
  };

  return (
    <div className="bg-surface border border-border-default rounded-2xl overflow-hidden">
      <button onClick={() => setExpanded((v) => !v)} className="w-full flex items-center justify-between gap-3 p-4 hover:bg-slate-50 transition-colors">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-primary-soft text-primary rounded-xl shrink-0">
            <Radio className="w-4 h-4" />
          </div>
          <div className="text-right">
            <div className="font-bold text-sm text-text-primary">{title}</div>
            {props.mode === 'single' && <LiveStatusBadge freshness={props.position?.freshness ?? null} receivedAt={props.position?.receivedAt} className="mt-1" />}
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-text-tertiary shrink-0" /> : <ChevronDown className="w-4 h-4 text-text-tertiary shrink-0" />}
      </button>

      {expanded && (
        <div className="border-t border-border-default animate-fade-in">
          {!hasData ? (
            <EmptyState
              icon={<Radio />}
              title="لا يوجد موقع مباشر متاح الآن"
              description="سيظهر الموقع هنا فور توفر بيانات تتبع حقيقية للرحلة."
            />
          ) : (
            <div className="relative" style={{ height }}>
              <div ref={mapContainerRef} className="w-full h-full" />
              <button
                onClick={recenter}
                title="توسيط الخريطة"
                className="absolute bottom-3 right-3 z-[400] w-9 h-9 rounded-lg bg-white shadow-md border border-border-default flex items-center justify-center text-text-secondary"
              >
                <Crosshair className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
