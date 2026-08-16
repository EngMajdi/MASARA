import { describe, it, expect } from 'vitest';
import { schoolRepository } from '../../server/repositories/schoolRepository';
import { studentRepository } from '../../server/repositories/studentRepository';
import { busRepository } from '../../server/repositories/busRepository';
import { tripRepository } from '../../server/repositories/tripRepository';
import { incidentRepository } from '../../server/repositories/incidentRepository';

describe('Repository layer (create/read/update)', () => {
  it('reads seeded schools', () => {
    const schools = schoolRepository.findAll();
    expect(schools.length).toBeGreaterThanOrEqual(1);
    expect(schoolRepository.findById(schools[0].id)?.id).toBe(schools[0].id);
  });

  it('reads seeded students scoped to a bus', () => {
    const bus = busRepository.findAll()[0];
    const busStudents = studentRepository.findByBusId(bus.id);
    expect(busStudents.length).toBeGreaterThan(0);
    expect(busStudents.every((s) => s.busId === bus.id)).toBe(true);
  });

  it('creates and reads back an incident', () => {
    const trip = tripRepository.findAll()[0];
    const created = incidentRepository.create({
      tripId: trip.id,
      busId: trip.busId,
      type: 'TRAFFIC',
      severity: 'medium',
      description: 'test traffic incident',
      status: 'open',
    });
    const found = incidentRepository.findByTripId(trip.id).find((i) => i.id === created.id);
    expect(found?.description).toBe('test traffic incident');
  });

  it('updates a bus record', () => {
    const bus = busRepository.findAll()[0];
    busRepository.update(bus.id, { speedKmh: 55 });
    expect(busRepository.findById(bus.id)?.speedKmh).toBe(55);
  });

  it('updates a trip record', () => {
    const trip = tripRepository.findAll()[0];
    const newEta = new Date(Date.now() + 3_600_000);
    tripRepository.update(trip.id, { currentEtaAt: newEta });
    // SQLite integer timestamp columns store second precision, not milliseconds.
    const stored = tripRepository.findById(trip.id)?.currentEtaAt?.getTime() ?? 0;
    expect(Math.abs(stored - newEta.getTime())).toBeLessThan(1000);
  });
});
