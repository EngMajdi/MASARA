import { tripRepository } from '../repositories/tripRepository';
import { studentRepository } from '../repositories/studentRepository';
import { boardingEventRepository } from '../repositories/boardingEventRepository';

export interface SafetyCheckResult {
  alert: boolean;
  reason?: string;
  missingStudentIds: string[];
}

// Spec §28 safety invariant: a trip must not be considered complete while any
// student assigned to its bus has no final boarding-event record
// (dropped_off or absent).
export function evaluateTripCompletionSafety(tripId: string): SafetyCheckResult {
  const trip = tripRepository.findById(tripId);
  if (!trip || trip.status !== 'completed') {
    return { alert: false, missingStudentIds: [] };
  }

  const assignedStudents = studentRepository.findByBusId(trip.busId);
  const events = boardingEventRepository.findByTripId(tripId);
  const resolvedStudentIds = new Set(
    events.filter((e) => e.eventType === 'dropped_off' || e.eventType === 'absent').map((e) => e.studentId)
  );

  const missingStudentIds = assignedStudents.filter((s) => !resolvedStudentIds.has(s.id)).map((s) => s.id);

  return {
    alert: missingStudentIds.length > 0,
    reason:
      missingStudentIds.length > 0
        ? `${missingStudentIds.length} طالب بدون حالة نزول نهائية مسجلة عند اكتمال الرحلة.`
        : undefined,
    missingStudentIds,
  };
}
