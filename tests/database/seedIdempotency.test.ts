import { describe, it, expect } from 'vitest';
import { seed } from '../../database/seed/seed';
import { runForTrip } from '../../server/agents/MasaraOperationsAgent';
import { tripRepository } from '../../server/repositories/tripRepository';
import { studentRepository } from '../../server/repositories/studentRepository';
import { createJourney, boardStudent, startJourney, startBoarding } from '../../server/services/JourneyService';

describe('Seed script teardown order', () => {
  it('can reseed after governance tables have rows (predictions/recommendations/audit_logs) without FK errors', async () => {
    const trip = tripRepository.findAll().find((t) => t.status === 'active')!;
    // Populates predictions, and usually ai_recommendations + audit_logs, referencing this trip.
    await runForTrip(trip.id);
    expect(() => seed()).not.toThrow();
  });

  it('can reseed after journeys table has rows too (spec Phase 3A — this exact FK-order bug has recurred every time a new table was added)', () => {
    const trip = tripRepository.findAll()[0];
    const student = studentRepository.findByBusId(trip.busId)[0];
    let journey = createJourney(student.id, trip.id, { actorId: null, actorType: 'system' });
    journey = startJourney(journey.id, { actorId: null, actorType: 'system' });
    startBoarding(journey.id, { actorId: null, actorType: 'system' });
    boardStudent(journey.id, { actorId: null, actorType: 'system' }); // journeys row + boarding_events row + audit_logs rows
    expect(() => seed()).not.toThrow();
  });
});
