import 'dotenv/config';
import { db } from '../client';
import { schoolRepository } from '../../server/repositories/schoolRepository';
import { legacyUserRepository } from '../../server/repositories/legacyUserRepository';
import { userRepository } from '../../server/repositories/userRepository';
import { hashPassword } from '../../server/services/legacyAuthCredentials';

// Phase 15.5 — Cloud Pilot Readiness: the ONE-TIME, NON-DESTRUCTIVE bootstrap
// for a real single-school pilot.
//
// PROBLEM this closes: `thePilotSchoolId()` (ProvisioningService.ts,
// FleetProvisioningService.ts) requires a `schools` row to already exist
// before ANY live provisioning (parent registration, employee creation,
// bus/route/trip creation) can work — and until this file existed, the
// ONLY thing that ever created a `schools` row was `database/seed/seed.ts`,
// whose own `seed()` function unconditionally calls `clearAll()` and wipes
// every table before inserting ~50 demo accounts, all sharing the single
// hardcoded password "password123" (visible in that file and in every
// prior phase report). Running that seed against a real pilot database —
// even once, "just to get the school row" — would both (a) destroy any
// real data already collected and (b) plant publicly-known admin/driver/
// parent credentials into a database that will hold real families' data.
//
// This script is the one alternative: it creates exactly one real school
// and one real admin account (legacy + governed, transactionally, via the
// exact same repositories/pattern ProvisioningService.ts already uses —
// no new architecture, no new tables), using operator-supplied values from
// the environment. No demo drivers, no demo parents, no synthetic
// students, no hardcoded password. It never calls clearAll() and never
// touches any existing row.
//
// IDEMPOTENT / SAFE TO RE-RUN: if a school already exists, this script
// does nothing and exits 0 — it will not create a second school, and it
// will not overwrite the admin account it already created. Re-running it
// by mistake against an already-initialized pilot database is a no-op,
// never a duplicate or destructive write.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} is required to run database/seed/genesis.ts (set it in the environment / Secret Manager — never hardcode it).`);
  }
  return value.trim();
}

export function genesis(): { alreadyInitialized: boolean; schoolId?: string; adminEmail?: string } {
  const existingSchool = schoolRepository.findAll()[0];
  if (existingSchool) {
    return { alreadyInitialized: true };
  }

  const adminEmail = requireEnv('PILOT_ADMIN_EMAIL').toLowerCase();
  const adminPassword = requireEnv('PILOT_ADMIN_PASSWORD');
  const adminName = process.env.PILOT_ADMIN_NAME?.trim() || 'مدير النظام';
  const schoolNameAr = process.env.PILOT_SCHOOL_NAME_AR?.trim() || 'المدرسة';
  const schoolNameEn = process.env.PILOT_SCHOOL_NAME_EN?.trim() || undefined;
  const schoolLat = process.env.PILOT_SCHOOL_LAT ? Number(process.env.PILOT_SCHOOL_LAT) : 23.588;
  const schoolLng = process.env.PILOT_SCHOOL_LNG ? Number(process.env.PILOT_SCHOOL_LNG) : 58.3829;
  const schoolAddress = process.env.PILOT_SCHOOL_ADDRESS?.trim() || 'عُمان';
  const schoolStartTime = process.env.PILOT_SCHOOL_START_TIME?.trim() || '07:00';
  const schoolEndTime = process.env.PILOT_SCHOOL_END_TIME?.trim() || '13:30';

  if (adminPassword.length < 8) {
    throw new Error('PILOT_ADMIN_PASSWORD must be at least 8 characters — refusing to create the pilot admin account with a weak password.');
  }

  const passwordHash = hashPassword(adminPassword);

  const ids = db.transaction((tx) => {
    const school = schoolRepository.create(
      {
        nameAr: schoolNameAr,
        nameEn: schoolNameEn ?? null,
        lat: schoolLat,
        lng: schoolLng,
        address: schoolAddress,
        startTime: schoolStartTime,
        endTime: schoolEndTime,
      },
      tx
    );
    const legacyAdmin = legacyUserRepository.create(
      { name: adminName, email: adminEmail, passwordHash, role: 'admin', status: 'active', mustChangePassword: false },
      tx
    );
    const governedAdmin = userRepository.create(
      { schoolId: school.id, name: adminName, email: adminEmail, passwordHash, role: 'admin' },
      tx
    );
    return { schoolId: school.id, legacyId: legacyAdmin.id, governedId: governedAdmin.id };
  });

  return { alreadyInitialized: false, schoolId: ids.schoolId, adminEmail };
}

if (process.argv[1] && process.argv[1].endsWith('genesis.ts')) {
  const result = genesis();
  if (result.alreadyInitialized) {
    console.log('ℹ️  Pilot already initialized — a school already exists. No changes made.');
  } else {
    console.log(`✅ Pilot genesis complete: school ${result.schoolId}, admin ${result.adminEmail}.`);
    console.log('   Log in through the real UI with the PILOT_ADMIN_EMAIL / PILOT_ADMIN_PASSWORD you supplied.');
  }
}
