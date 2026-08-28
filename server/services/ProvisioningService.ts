import { db } from '../../database/client';
import { hashPassword, generateTemporaryPassword } from './legacyAuthCredentials';
import { legacyUserRepository } from '../repositories/legacyUserRepository';
import { userRepository } from '../repositories/userRepository';
import { driverRepository } from '../repositories/driverRepository';
import { schoolRepository } from '../repositories/schoolRepository';

// Phase 14 — Production Onboarding & Account Provisioning.
//
// PROBLEM (found live during Phase 13.1's own adversarial verification,
// documented in docs/PHASE_13_STUDENT_IDENTITY_AND_PARENT_LIVE_JOURNEY_REPORT.md
// §25): the governed `users`/`drivers` tables had NO live creation path at
// all — every row came from database/seed/seed.ts. `POST /api/auth/register`
// and `POST /api/admin/employees` each created only a `legacy_users` row.
// A real parent or driver provisioned through the app's own UI could log in
// (the legacy session is real) but every governed API (`/api/parent/*`,
// `/api/driver/*`, ...) returned 404 "المستخدم غير موجود في نظام الحوكمة" —
// Parent Live Journey and the Driver Console were unreachable for anyone
// who wasn't hand-seeded.
//
// FIX: this file is the ONE place a legacy account and its governed
// counterpart are created together. It does not replace the legacy session
// as the authentication source (spec: do not duplicate auth systems) — it
// only ensures every legacy identity this app creates also gets the
// governed-side record every existing governed guard already expects,
// joined by the same email key every guard already uses
// (server/services/authz.ts's own header comment).
//
// ATOMICITY: legacy_users and governed users/drivers are, in this specific
// deployment, tables in the SAME physical SQLite database file
// (database/client.ts — one `Database` connection, one `drizzle()` wrapper
// over it). That means real, single-transaction atomicity is available and
// is used here (`db.transaction`) — this is not a cross-system saga /
// eventual-consistency problem, it is one database with two table
// namespaces, and the fix treats it as such.
//
// RECONCILIATION: for accounts that already exist on only one side
// (the pre-Phase-14 legacy-only registrations, and driver2/driver3's
// pre-existing governed-only accounts discovered in Phase 13.1),
// `reconcileMissingGovernedUsers` and `reconcileMissingLegacyLogins` below
// provide a deterministic, idempotent, admin-triggered repair — matched
// exclusively by email (the same join key every guard already trusts),
// never by name. Nothing here is auto-run; an admin must explicitly invoke
// it (POST /api/admin/provisioning/reconcile).

export class ProvisioningError extends Error {}

function thePilotSchoolId(): string {
  const school = schoolRepository.findAll()[0];
  if (!school) throw new ProvisioningError('لا توجد مدرسة مهيأة في النظام.');
  return school.id;
}

type LegacyUserRow = ReturnType<typeof legacyUserRepository.findAll>[number];
type GovernedUserRow = ReturnType<typeof userRepository.findAll>[number];

/**
 * Idempotent: if a governed user with this email already exists, returns it
 * unchanged (never a second row, never overwritten) — the unique index on
 * `legacy_users.email`/`users.email` isn't itself cross-checked here, but
 * every caller of this function already holds a real, existing legacy row
 * to copy from, so there is never a guess involved.
 */
function ensureGovernedCounterpart(legacyUser: LegacyUserRow): GovernedUserRow {
  const existing = userRepository.findByEmail(legacyUser.email);
  if (existing) return existing;
  const created = userRepository.create({
    schoolId: thePilotSchoolId(),
    name: legacyUser.name,
    email: legacyUser.email,
    passwordHash: legacyUser.passwordHash,
    role: legacyUser.role,
  });
  return userRepository.findById(created.id)!;
}

export type ParentRegistrationResult =
  | { status: 'CREATED'; legacyUser: LegacyUserRow; governedUser: GovernedUserRow }
  | { status: 'ALREADY_REGISTERED' };

/**
 * The registration path (spec §9). Validation (required fields, password
 * policy) stays the caller's responsibility (server.ts), exactly as before
 * — this function's only job is the two-store persistence, atomically.
 *
 * Reconciliation case (spec §11): if the email already has a real legacy
 * account but its governed counterpart is missing (the exact class of bug
 * this phase closes), that gap is repaired in place — never a second
 * legacy account, never a guessed identity. The caller still sees
 * "already registered" either way, since it genuinely is.
 */
export function provisionParentAccount(input: { name: string; email: string; password: string }): ParentRegistrationResult {
  const email = input.email.trim();
  const existingLegacy = legacyUserRepository.findByEmail(email);
  if (existingLegacy) {
    ensureGovernedCounterpart(existingLegacy);
    return { status: 'ALREADY_REGISTERED' };
  }

  const schoolId = thePilotSchoolId();
  const passwordHash = hashPassword(input.password);

  const ids = db.transaction((tx) => {
    const legacyRow = legacyUserRepository.create({ name: input.name, email, passwordHash, role: 'parent' }, tx);
    const governedRow = userRepository.create({ schoolId, name: input.name, email, passwordHash, role: 'parent' }, tx);
    return { legacyId: legacyRow.id, governedId: governedRow.id };
  });

  return {
    status: 'CREATED',
    legacyUser: legacyUserRepository.findById(ids.legacyId)!,
    governedUser: userRepository.findById(ids.governedId)!,
  };
}

export type EmployeeProvisioningResult = {
  legacyUser: LegacyUserRow;
  governedUser: GovernedUserRow;
  governedDriverId: string | null;
  temporaryPassword: string;
};

/**
 * The admin-issued employee path (spec §15). Role validation (must be one
 * of EMPLOYEE_ROLES, never client-selectable beyond that) and the
 * existing-email check both stay the caller's responsibility (server.ts),
 * matching the pre-existing `/api/admin/employees` contract exactly.
 *
 * For `role === 'driver'`, a governed `drivers` row is created and linked
 * (`userId`) in the same transaction — the gap that left driver2/driver3
 * governed-but-not-legacy-loginable is closed at the SOURCE for every
 * future hire, not patched per-account (spec §5/§15: "do not hardcode
 * fixes specifically for driver2/driver3").
 */
export function provisionEmployeeAccount(input: {
  name: string;
  email: string;
  role: 'driver' | 'school' | 'admin';
  phone?: string;
  createdByUserId: string;
}): EmployeeProvisioningResult {
  const email = input.email.trim();
  const schoolId = thePilotSchoolId();
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = hashPassword(temporaryPassword);

  const ids = db.transaction((tx) => {
    const legacyRow = legacyUserRepository.create(
      {
        name: input.name,
        email,
        passwordHash,
        role: input.role,
        status: 'active',
        mustChangePassword: true,
        createdByUserId: input.createdByUserId,
      },
      tx
    );
    const governedRow = userRepository.create({ schoolId, name: input.name, email, passwordHash, role: input.role }, tx);
    let governedDriverId: string | null = null;
    if (input.role === 'driver') {
      const driver = driverRepository.create({ userId: governedRow.id, name: input.name, phone: input.phone?.trim() || '' }, tx);
      governedDriverId = driver.id;
    }
    return { legacyId: legacyRow.id, governedId: governedRow.id, governedDriverId };
  });

  return {
    legacyUser: legacyUserRepository.findById(ids.legacyId)!,
    governedUser: userRepository.findById(ids.governedId)!,
    governedDriverId: ids.governedDriverId,
    temporaryPassword,
  };
}

export type ReconciliationReport = {
  governedUsersCreated: { email: string; role: string }[];
  governedDriversCreated: { email: string }[];
  legacyLoginsCreated: { email: string; role: string; temporaryPassword: string }[];
};

/**
 * For every real legacy account with no governed counterpart (email-matched
 * — the pre-Phase-14 registration/employee-creation gap), provisions the
 * missing governed user (and, for drivers, the missing governed `drivers`
 * row) deterministically from the existing legacy row. Idempotent — safe
 * to run repeatedly; never creates a duplicate.
 */
export function reconcileMissingGovernedUsers(): Pick<ReconciliationReport, 'governedUsersCreated' | 'governedDriversCreated'> {
  const schoolId = thePilotSchoolId();
  const governedUsersCreated: ReconciliationReport['governedUsersCreated'] = [];
  const governedDriversCreated: ReconciliationReport['governedDriversCreated'] = [];

  for (const legacyUser of legacyUserRepository.findAll()) {
    let governedUser = userRepository.findByEmail(legacyUser.email);
    if (!governedUser) {
      const created = userRepository.create({
        schoolId,
        name: legacyUser.name,
        email: legacyUser.email,
        passwordHash: legacyUser.passwordHash,
        role: legacyUser.role,
      });
      governedUser = userRepository.findById(created.id)!;
      governedUsersCreated.push({ email: legacyUser.email, role: legacyUser.role });
    }
    if (legacyUser.role === 'driver' && !driverRepository.findByUserId(governedUser.id)) {
      driverRepository.create({ userId: governedUser.id, name: legacyUser.name, phone: '' });
      governedDriversCreated.push({ email: legacyUser.email });
    }
  }

  return { governedUsersCreated, governedDriversCreated };
}

/**
 * The inverse direction — the exact driver2/driver3 class of gap found
 * live in Phase 13.1: a governed user/driver exists but has no
 * `legacy_users` row at all, so it can never authenticate via the real
 * `/api/auth/login` endpoint. Deterministic (matched by email, the same
 * join key every guard trusts) and generic — this scans every governed
 * user, never a hardcoded list of names. A fresh temporary password is
 * generated and returned once, exactly like `/api/admin/employees` already
 * does, for the admin to hand to the real person out-of-band.
 */
export function reconcileMissingLegacyLogins(): Pick<ReconciliationReport, 'legacyLoginsCreated'> {
  const legacyLoginsCreated: ReconciliationReport['legacyLoginsCreated'] = [];

  for (const governedUser of userRepository.findAll()) {
    if (legacyUserRepository.findByEmail(governedUser.email)) continue;
    const temporaryPassword = generateTemporaryPassword();
    legacyUserRepository.create({
      name: governedUser.name,
      email: governedUser.email,
      passwordHash: hashPassword(temporaryPassword),
      role: governedUser.role,
      status: 'active',
      mustChangePassword: true,
    });
    legacyLoginsCreated.push({ email: governedUser.email, role: governedUser.role, temporaryPassword });
  }

  return { legacyLoginsCreated };
}
