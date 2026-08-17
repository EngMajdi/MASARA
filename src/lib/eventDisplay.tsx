import React from 'react';
import {
  PlayCircle,
  Navigation,
  AlertTriangle,
  ShieldAlert,
  Brain,
  ShieldCheck,
  Clock,
  CheckCircle2,
  XCircle,
  Settings,
  CheckCheck,
  FlagTriangleRight,
  Ban,
  Siren,
  Flag,
  MessageSquareWarning,
  UserCheck,
  UserX,
  MapPin,
  DoorOpen,
  UserPlus,
} from 'lucide-react';

// Shared across SimulationCenter and AIOperationsFeed so the event vocabulary
// (spec §13/§23) is labeled/iconified in exactly one place — no color-only
// signaling (icon + label + text always travel together, spec §27).

export const EVENT_LABELS: Record<string, string> = {
  SIMULATION_STARTED: 'بدأت المحاكاة',
  SIMULATION_COMPLETED: 'اكتملت المحاكاة',
  SIMULATION_FAILED: 'فشلت المحاكاة',
  SIMULATION_CANCELLED: 'أُلغيت المحاكاة',
  TRIP_STARTED: 'بدأت الرحلة',
  BUS_MOVING: 'الحافلة في حركة',
  TRAFFIC_DETECTED: 'ازدحام مروري مكتشف',
  SAFETY_INCIDENT: 'حادثة سلامة',
  TRIP_COMPLETED: 'اكتملت الرحلة',
  AI_OUTPUT_REJECTED: 'مخرجات ذكاء اصطناعي غير صالحة',
  RECOMMENDATION_CREATED: 'توصية ذكاء اصطناعي جديدة',
  POLICY_EVALUATED: 'تقييم محرك السياسات',
  APPROVAL_REQUESTED: 'بانتظار قرار المشرف',
  REVIEW_REQUESTED: 'طلب مراجعة',
  APPROVED: 'تمت الموافقة',
  REJECTED: 'تم الرفض',
  EXPIRED: 'انتهت صلاحية التوصية',
  RECOMMENDATION_CANCELLED: 'أُلغيت التوصية',
  ACTION_STARTED: 'بدأ تنفيذ الإجراء',
  ACTION_COMPLETED: 'اكتمل تنفيذ الإجراء',
  ACTION_FAILED: 'فشل تنفيذ الإجراء',
  VERIFICATION_STARTED: 'بدأ التحقق من النتيجة',
  VERIFICATION_COMPLETED: 'اكتمل التحقق بنجاح',
  VERIFICATION_FAILED: 'فشل التحقق',
  // Journey Core (Phase 3A)
  JOURNEY_CREATED: 'تم إنشاء رحلة طالب',
  JOURNEY_STARTED: 'بدأت رحلة الطالب',
  BOARDING_STARTED: 'بدأ الصعود',
  STUDENT_BOARDED: 'صعد الطالب إلى الحافلة',
  TRANSIT_STARTED: 'بدأت الحافلة التنقل',
  STOP_APPROACHING: 'الحافلة تقترب من نقطة التوقف',
  STUDENT_DROPPED_OFF: 'نزل الطالب من الحافلة',
  JOURNEY_COMPLETED: 'اكتملت رحلة الطالب',
  STUDENT_MISSED: 'تغيّب الطالب عن الرحلة',
  JOURNEY_CANCELLED: 'أُلغيت رحلة الطالب',
  JOURNEY_INCIDENT: 'حادثة أثناء رحلة الطالب',
};

export function labelFor(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType;
}

const ICONS: Record<string, React.ReactNode> = {
  SIMULATION_STARTED: <PlayCircle className="w-4 h-4" />,
  SIMULATION_COMPLETED: <CheckCheck className="w-4 h-4" />,
  SIMULATION_FAILED: <XCircle className="w-4 h-4" />,
  SIMULATION_CANCELLED: <Ban className="w-4 h-4" />,
  TRIP_STARTED: <PlayCircle className="w-4 h-4" />,
  BUS_MOVING: <Navigation className="w-4 h-4" />,
  TRAFFIC_DETECTED: <AlertTriangle className="w-4 h-4" />,
  SAFETY_INCIDENT: <Siren className="w-4 h-4" />,
  TRIP_COMPLETED: <Flag className="w-4 h-4" />,
  AI_OUTPUT_REJECTED: <MessageSquareWarning className="w-4 h-4" />,
  RECOMMENDATION_CREATED: <Brain className="w-4 h-4" />,
  POLICY_EVALUATED: <ShieldCheck className="w-4 h-4" />,
  APPROVAL_REQUESTED: <Clock className="w-4 h-4" />,
  REVIEW_REQUESTED: <FlagTriangleRight className="w-4 h-4" />,
  APPROVED: <CheckCircle2 className="w-4 h-4" />,
  REJECTED: <XCircle className="w-4 h-4" />,
  EXPIRED: <Clock className="w-4 h-4" />,
  RECOMMENDATION_CANCELLED: <Ban className="w-4 h-4" />,
  ACTION_STARTED: <Settings className="w-4 h-4" />,
  ACTION_COMPLETED: <CheckCircle2 className="w-4 h-4" />,
  ACTION_FAILED: <XCircle className="w-4 h-4" />,
  VERIFICATION_STARTED: <ShieldCheck className="w-4 h-4" />,
  VERIFICATION_COMPLETED: <CheckCheck className="w-4 h-4" />,
  VERIFICATION_FAILED: <XCircle className="w-4 h-4" />,
  // Journey Core (Phase 3A)
  JOURNEY_CREATED: <UserPlus className="w-4 h-4" />,
  JOURNEY_STARTED: <PlayCircle className="w-4 h-4" />,
  BOARDING_STARTED: <DoorOpen className="w-4 h-4" />,
  STUDENT_BOARDED: <UserCheck className="w-4 h-4" />,
  TRANSIT_STARTED: <Navigation className="w-4 h-4" />,
  STOP_APPROACHING: <MapPin className="w-4 h-4" />,
  STUDENT_DROPPED_OFF: <DoorOpen className="w-4 h-4" />,
  JOURNEY_COMPLETED: <Flag className="w-4 h-4" />,
  STUDENT_MISSED: <UserX className="w-4 h-4" />,
  JOURNEY_CANCELLED: <Ban className="w-4 h-4" />,
  JOURNEY_INCIDENT: <Siren className="w-4 h-4" />,
};

export function iconFor(eventType: string): React.ReactNode {
  return ICONS[eventType] ?? <ShieldAlert className="w-4 h-4" />;
}

const COLORS: Record<string, string> = {
  ACTION_FAILED: 'text-rose-600 bg-rose-50 border-rose-200',
  VERIFICATION_FAILED: 'text-rose-600 bg-rose-50 border-rose-200',
  SIMULATION_FAILED: 'text-rose-600 bg-rose-50 border-rose-200',
  REJECTED: 'text-rose-600 bg-rose-50 border-rose-200',
  SAFETY_INCIDENT: 'text-rose-700 bg-rose-100 border-rose-300',
  TRAFFIC_DETECTED: 'text-amber-700 bg-amber-50 border-amber-200',
  APPROVAL_REQUESTED: 'text-amber-700 bg-amber-50 border-amber-200',
  EXPIRED: 'text-slate-500 bg-slate-100 border-slate-300',
  RECOMMENDATION_CANCELLED: 'text-slate-500 bg-slate-100 border-slate-300',
  SIMULATION_CANCELLED: 'text-slate-500 bg-slate-100 border-slate-300',
  APPROVED: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  ACTION_COMPLETED: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  VERIFICATION_COMPLETED: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  SIMULATION_COMPLETED: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  TRIP_COMPLETED: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  // Journey Core (Phase 3A)
  JOURNEY_INCIDENT: 'text-rose-700 bg-rose-100 border-rose-300',
  STUDENT_MISSED: 'text-amber-700 bg-amber-50 border-amber-200',
  JOURNEY_CANCELLED: 'text-slate-500 bg-slate-100 border-slate-300',
  STUDENT_BOARDED: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  STUDENT_DROPPED_OFF: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  JOURNEY_COMPLETED: 'text-emerald-700 bg-emerald-50 border-emerald-200',
};

export function colorFor(eventType: string): string {
  return COLORS[eventType] ?? 'text-blue-700 bg-blue-50 border-blue-200';
}

// --- Journey *state* display (Phase 3B) — distinct from the event-type maps
// above: a Journey's current `state` (e.g. "on_bus") is not the same string
// as the audit event that produced it (e.g. "STUDENT_BOARDED"). Status is
// never color-only here either — icon + label + color always travel
// together (spec §27/§64).

import type { JourneyState } from '../types';

export const JOURNEY_STATE_LABELS: Record<JourneyState, string> = {
  scheduled: 'مجدولة',
  waiting: 'بانتظار الصعود',
  boarding: 'جارٍ الصعود الآن',
  on_bus: 'على متن الحافلة',
  in_transit: 'في الطريق',
  approaching_stop: 'يقترب من نقطة التوقف',
  dropped_off: 'تم النزول',
  completed: 'اكتملت الرحلة',
  cancelled: 'ملغاة',
  missed: 'تغيّب الطالب',
  incident: 'حادثة قيد المراجعة',
};

const JOURNEY_STATE_ICONS: Record<JourneyState, React.ReactNode> = {
  scheduled: <Clock className="w-3.5 h-3.5" />,
  waiting: <Clock className="w-3.5 h-3.5" />,
  boarding: <DoorOpen className="w-3.5 h-3.5" />,
  on_bus: <UserCheck className="w-3.5 h-3.5" />,
  in_transit: <Navigation className="w-3.5 h-3.5" />,
  approaching_stop: <MapPin className="w-3.5 h-3.5" />,
  dropped_off: <DoorOpen className="w-3.5 h-3.5" />,
  completed: <Flag className="w-3.5 h-3.5" />,
  cancelled: <Ban className="w-3.5 h-3.5" />,
  missed: <UserX className="w-3.5 h-3.5" />,
  incident: <Siren className="w-3.5 h-3.5" />,
};

const JOURNEY_STATE_COLORS: Record<JourneyState, string> = {
  scheduled: 'text-slate-600 bg-slate-100 border-slate-300',
  waiting: 'text-amber-700 bg-amber-50 border-amber-200',
  boarding: 'text-amber-700 bg-amber-50 border-amber-200',
  on_bus: 'text-blue-700 bg-blue-50 border-blue-200',
  in_transit: 'text-blue-700 bg-blue-50 border-blue-200',
  approaching_stop: 'text-indigo-700 bg-indigo-50 border-indigo-200',
  dropped_off: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  completed: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  cancelled: 'text-slate-500 bg-slate-100 border-slate-300',
  missed: 'text-rose-700 bg-rose-50 border-rose-200',
  incident: 'text-rose-700 bg-rose-100 border-rose-300',
};

export function journeyStateLabel(state: JourneyState): string {
  return JOURNEY_STATE_LABELS[state] ?? state;
}

export function journeyStateIcon(state: JourneyState): React.ReactNode {
  return JOURNEY_STATE_ICONS[state] ?? <ShieldAlert className="w-3.5 h-3.5" />;
}

export function journeyStateColor(state: JourneyState): string {
  return JOURNEY_STATE_COLORS[state] ?? 'text-slate-600 bg-slate-100 border-slate-300';
}
