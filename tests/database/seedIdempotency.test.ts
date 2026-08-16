import { describe, it, expect } from 'vitest';
import { seed } from '../../database/seed/seed';
import { runForTrip } from '../../server/agents/MasaraOperationsAgent';
import { tripRepository } from '../../server/repositories/tripRepository';

describe('Seed script teardown order', () => {
  it('can reseed after governance tables have rows (predictions/recommendations/audit_logs) without FK errors', async () => {
    const trip = tripRepository.findAll().find((t) => t.status === 'active')!;
    // Populates predictions, and usually ai_recommendations + audit_logs, referencing this trip.
    await runForTrip(trip.id);
    expect(() => seed()).not.toThrow();
  });
});
