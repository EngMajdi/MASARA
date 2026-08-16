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
};

export function colorFor(eventType: string): string {
  return COLORS[eventType] ?? 'text-blue-700 bg-blue-50 border-blue-200';
}
