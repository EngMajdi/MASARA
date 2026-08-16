import { describe, it, expect } from 'vitest';
import { evaluateTripCompletionSafety } from '../../server/services/SafetyCheck';
import { tripRepository } from '../../server/repositories/tripRepository';
import { studentRepository } from '../../server/repositories/studentRepository';
import { boardingEventRepository } from '../../server/repositories/boardingEventRepository';

describe('Safety: trip completion vs boarding status (spec §28)', () => {
  it('alerts when a trip is marked completed but a student has no final boarding event', () => {
    const trip = tripRepository.findAll()[0];
    const students = studentRepository.findByBusId(trip.busId);
    expect(students.length).toBeGreaterThan(0);

    tripRepository.update(trip.id, { status: 'completed', completedAt: new Date() });

    const result = evaluateTripCompletionSafety(trip.id);
    expect(result.alert).toBe(true);
    expect(result.missingStudentIds.length).toBe(students.length);
  });

  it('does not alert once every assigned student has a final boarding event', () => {
    const trip = tripRepository.findAll()[1];
    const students = studentRepository.findByBusId(trip.busId);
    tripRepository.update(trip.id, { status: 'completed', completedAt: new Date() });

    for (const s of students) {
      boardingEventRepository.create({ tripId: trip.id, studentId: s.id, busId: trip.busId, eventType: 'dropped_off' });
    }

    const result = evaluateTripCompletionSafety(trip.id);
    expect(result.alert).toBe(false);
  });

  it('does not alert for a trip that is not yet completed', () => {
    const trip = tripRepository.findAll().find((t) => t.status !== 'completed');
    expect(trip).toBeTruthy();
    const result = evaluateTripCompletionSafety(trip!.id);
    expect(result.alert).toBe(false);
  });
});
