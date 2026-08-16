import { tripRepository } from '../repositories/tripRepository';
import { routeRepository } from '../repositories/routeRepository';
import { busRepository } from '../repositories/busRepository';

// Gate between "the AI proposed something" and "a human is even allowed to see
// this as approvable." Nothing here executes anything — it only says yes/no
// and why. This is what prevents a hidden bypass of human approval (spec §9/§29).

const KNOWN_ACTIONS = ['CHANGE_ROUTE', 'NOTIFY_SCHOOL', 'FLAG_INCIDENT', 'NO_ACTION'] as const;

export interface RecommendationForPolicy {
  action: string;
  targetId: string | null;
  requiresApproval: boolean;
}

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
}

export function evaluateRecommendation(rec: RecommendationForPolicy, tripId: string): PolicyCheckResult {
  if (!KNOWN_ACTIONS.includes(rec.action as (typeof KNOWN_ACTIONS)[number])) {
    return { allowed: false, reason: `إجراء غير معروف: "${rec.action}".` };
  }

  const trip = tripRepository.findById(tripId);
  if (!trip) return { allowed: false, reason: 'الرحلة غير موجودة.' };
  if (trip.status !== 'active' && trip.status !== 'scheduled') {
    return { allowed: false, reason: `لا يمكن تنفيذ إجراءات على رحلة بحالة "${trip.status}".` };
  }

  const bus = busRepository.findById(trip.busId);
  if (!bus) return { allowed: false, reason: 'الحافلة غير موجودة.' };

  if (rec.action === 'CHANGE_ROUTE') {
    if (bus.status === 'maintenance') {
      return { allowed: false, reason: 'لا يمكن تغيير مسار حافلة في حالة صيانة.' };
    }
    if (!rec.targetId) {
      return { allowed: false, reason: 'إجراء تغيير المسار يتطلب تحديد مسار هدف (targetId).' };
    }
    const targetRoute = routeRepository.findById(rec.targetId);
    if (!targetRoute) {
      return { allowed: false, reason: 'المسار المستهدف غير موجود.' };
    }
    if (targetRoute.schoolId !== bus.schoolId) {
      return { allowed: false, reason: 'المسار المستهدف لا يتبع نفس المدرسة.' };
    }
  }

  // Safety invariant: every state-changing action must require human approval.
  // If an LLM/mock ever claims otherwise, the policy engine overrides it and denies.
  if (rec.action !== 'NO_ACTION' && !rec.requiresApproval) {
    return { allowed: false, reason: 'الإجراءات المؤثرة على الحالة التشغيلية يجب أن تتطلب موافقة بشرية.' };
  }

  return { allowed: true };
}
