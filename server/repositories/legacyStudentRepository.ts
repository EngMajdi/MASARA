import { eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { legacyStudents } from '../../database/schema';
import type { Student } from '../../src/types';

type LegacyStudentRow = typeof legacyStudents.$inferSelect;

// Phase 7K — persistence for server.ts's legacy student resource
// (previously `let students = [...INITIAL_STUDENTS]`). Same treatment as
// legacyBusRepository.ts: pure data access + shape mapping, nested
// `pickupPoint: {lat,lng,address,nameAr}` flattened in the table and
// reassembled here so every existing API caller sees the exact same
// shape (src/types.ts's `Student` interface) it always has.

export type LegacyStudentView = Student & { parentId: string | null };

/** Fields the legacy create-student form (DataManagementModal.tsx) actually sends. parentId is deliberately excluded — never accepted from a caller; see create() below. */
export type LegacyStudentCreateInput = Omit<Student, 'id' | 'parentId'>;

function toView(row: LegacyStudentRow): LegacyStudentView {
  return {
    id: row.id,
    name: row.name,
    grade: row.grade,
    avatar: row.avatar,
    schoolId: row.schoolId,
    schoolName: row.schoolName,
    parentId: row.parentId,
    parentName: row.parentName,
    parentPhone: row.parentPhone,
    busId: row.busId,
    busNumber: row.busNumber,
    pickupPoint: { lat: row.pickupLat, lng: row.pickupLng, address: row.pickupAddress, nameAr: row.pickupNameAr },
    status: row.status as Student['status'],
    pickupTimePlanned: row.pickupTimePlanned,
    pickupTimeActual: row.pickupTimeActual ?? undefined,
    seatNumber: row.seatNumber,
  };
}

export const legacyStudentRepository = {
  findAll: (): LegacyStudentView[] => db.select().from(legacyStudents).all().map(toView),

  findById: (id: string): LegacyStudentView | undefined => {
    const row = db.select().from(legacyStudents).where(eq(legacyStudents.id, id)).get();
    return row ? toView(row) : undefined;
  },

  // Server-side only — never derived from a client body. The existing
  // create-student form has always sent a placeholder `parentId: 'par-new'`
  // (source-audited: DataManagementModal.tsx) that never referenced a real
  // identity; that placeholder is deliberately dropped here rather than
  // stored, since no trusted assignment mechanism exists to honor it.
  create: (input: LegacyStudentCreateInput): LegacyStudentView => {
    const row = {
      id: `std-${Date.now()}`,
      name: input.name,
      grade: input.grade,
      avatar: input.avatar,
      schoolId: input.schoolId,
      schoolName: input.schoolName,
      parentId: null,
      parentName: input.parentName,
      parentPhone: input.parentPhone,
      busId: input.busId,
      busNumber: input.busNumber,
      pickupLat: input.pickupPoint.lat,
      pickupLng: input.pickupPoint.lng,
      pickupAddress: input.pickupPoint.address,
      pickupNameAr: input.pickupPoint.nameAr,
      status: input.status,
      pickupTimePlanned: input.pickupTimePlanned,
      pickupTimeActual: input.pickupTimeActual ?? null,
      seatNumber: input.seatNumber,
    };
    db.insert(legacyStudents).values(row).run();
    return toView(db.select().from(legacyStudents).where(eq(legacyStudents.id, row.id)).get()!);
  },

  deleteById: (id: string): boolean => {
    const result = db.delete(legacyStudents).where(eq(legacyStudents.id, id)).run();
    return result.changes > 0;
  },

  /** Boarding/absence status mutation — the one write server.ts's status route performs. */
  updateStatus: (id: string, status: Student['status'], pickupTimeActual?: string): LegacyStudentView | undefined => {
    const patch: Partial<LegacyStudentRow> = { status, updatedAt: new Date() };
    if (pickupTimeActual !== undefined) patch.pickupTimeActual = pickupTimeActual;
    db.update(legacyStudents).set(patch).where(eq(legacyStudents.id, id)).run();
    return legacyStudentRepository.findById(id);
  },

  /** Phase 8B — the ownership assignment Phase 7K deliberately left unbuilt. Caller (server.ts route) is responsible for validating parentId resolves to an active legacy_users row with role='parent' before calling this — this method performs the write only. */
  updateParentId: (id: string, parentId: string | null): LegacyStudentView | undefined => {
    db.update(legacyStudents).set({ parentId, updatedAt: new Date() }).where(eq(legacyStudents.id, id)).run();
    return legacyStudentRepository.findById(id);
  },

  /** Test-only — full reset between test files. */
  clear: () => db.delete(legacyStudents).run(),
};
