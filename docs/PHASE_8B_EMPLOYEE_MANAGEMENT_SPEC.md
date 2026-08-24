# MASARA — PHASE 8B — Employee Account Management & Provisioning

**Status:** NOT STARTED — specification and implementation plan only. Do not implement any part of this phase until explicitly instructed.

**Baseline this phase builds on:** the local environment as of the end of the Phase 8A follow-up work (post-authentication-role-escalation fix, MapView/DriverPortal/ParentPortal ownership-leak fixes, `activeRole` persistence fix). Confirm the baseline test count and a clean `git status` before starting, exactly as every prior phase in this project has required.

---

## 1. Why this phase exists

Every phase since 7K has established real, server-enforced ownership for legacy resources (`legacy_buses.driverId`, `legacy_students.parentId`) — but the *employees who hold that ownership* (drivers, school staff, admins) can currently only exist as one of the four fixed demo rows seeded by `database/seed/seed.ts`. There is no product path — self-service or admin-driven — to provision a new real driver or school-staff account. `POST /api/auth/register` is intentionally locked to `role: 'parent'` (a deliberate security fix; self-registration must never create a staff account), and the "driver" fields on the bus-creation form in `DataManagementModal.tsx` are free-text labels (`driverName`, `driverPhone`) with no connection to `legacy_users` at all.

For a real operational deployment, a school administrator must be able to onboard a new driver or staff member, assign them the right role, hand them a way to log in, and later deactivate them or reassign their resources — all without an email provider, since none is configured in this codebase (see `.env.example`; `NOTIFICATION_EMAIL_ENABLED="false"`).

## 2. Scope (explicitly requested)

1. Employee creation (admin-initiated, not self-service)
2. Role assignment (at creation time)
3. Temporary credential / activation flow — **no email dependency**
4. Forced first-login password change
5. Account activation / deactivation
6. Session revocation (both as a side effect of deactivation and as a standalone admin action)
7. Server-side resource ownership assignment (driver ↔ bus, parent ↔ student) — closing the gap Phase 7K deliberately left open ("no assignment mechanism exists")

## 3. Explicit non-goals (do not implement, do not silently expand into)

- **No email dependency of any kind.** No "send activation email," no "email the temporary password," not even a fake/logged email. The temporary credential is returned directly to the admin performing the action, once, in the API response — the admin is responsible for relaying it out-of-band (in person, phone, existing internal channel). This mirrors the precedent already established in `server/services/deviceCredentials.ts`, where a device secret is generated, hashed for storage, and returned once to the caller that requested it — never re-derivable, never re-servable.
- **No MFA.** Separate concern, not required here.
- **No changes to the governed `users` table, `authz.ts`, or the governed identity model.** This phase is legacy-surface only, exactly like every phase since 7A. A newly created employee still has no governed-side counterpart — that dual-identity-store gap (documented repeatedly since Phase 5A/7I) stays open and undecided; do not resolve it as a side effect of this phase.
- **No automatic ownership assignment.** Every driver↔bus or parent↔student link is an explicit, server-recorded admin action. Never infer an assignment from a name match, a coincidence, or bulk-apply a guess — the same "do not fabricate a relationship" discipline that governed every ownership decision since Phase 7K.
- **No role changes after creation** in this phase's minimum scope (an employee's role is fixed at creation; promoting/demoting an existing employee is a plausible Phase 8C, not required here — flag it as a STOP-and-report if a later audit finds the two are impossible to cleanly separate).
- **No self-service password reset.** Because there is no email channel to prove the requester owns the account, "forgot password" for an employee is an **admin-initiated credential reset** (§7.5), not a self-service flow.

## 4. Architecture audit checklist (mandatory Step 0 for whoever implements this)

Before writing any code, confirm current reality — do not assume this document's field/route names are exhaustive or still accurate by the time implementation starts:

- Re-read `database/schema.ts`'s `legacyUsers` table and confirm no `status`/`mustChangePassword` columns have been added by an intervening phase.
- Re-read `server.ts`'s `/api/auth/login`, `/api/auth/register`, `/api/auth/change-password` in full — confirm the role-escalation fix (session role always from `user.role`, never `req.body.role`) is still intact, since this phase's login changes sit directly next to it.
- Re-read `server/services/legacyAuthz.ts` and `server/services/legacySessionService.ts` for the exact guard/session shapes to extend, not replace.
- Re-read `server/repositories/legacyUserRepository.ts`, `legacyBusRepository.ts`, `legacyStudentRepository.ts` for the exact repository conventions (shape mapping, `create`/`update` signatures) to match.
- Confirm the current baseline test count and record it before making any change (STOP and report if it does not match the number recorded at the end of the prior phase).

## 5. Data model changes (additive only, one migration)

Add to `legacyUsers` (`database/schema.ts`):

```
status: text('status').notNull().default('active'),          // 'active' | 'disabled'
mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
createdByUserId: text('created_by_user_id'),                  // nullable — audit trail only, no FK (self-registered parents have no creator)
```

- `status` gates login (§7.1) and is the field a deactivation action flips.
- `mustChangePassword` is set `true` only by the employee-creation flow (§7.2) and the credential-reset flow (§7.5); cleared by a successful `change-password` call (§7.3).
- `createdByUserId` is a plain nullable text column (no FK, matching the existing precedent of `legacy_sessions`/`legacy_buses` deliberately staying unconstrained where a clean FK isn't honestly supportable) — self-registered parents have no creator; seeded demo accounts have no creator; only admin-created employees populate it.
- Migration must be a single additive `ALTER TABLE` (new columns, all with defaults so existing rows — the 4 seeded demo accounts — remain valid without a backfill script). No DROP, no destructive change, matching every migration 0000–0012.
- Regenerate via `npm run db:generate`; expected next migration number is `0013`, following the existing sequence — confirm against `database/migrations/` at implementation time rather than trusting this number blindly.

No new table is needed for ownership assignment — `legacy_buses.driverId` and `legacy_students.parentId` already exist (Phase 7K) and are exactly what §7.6/§7.7 write to.

## 6. New authorization surface

Add to `server/services/legacyAuthz.ts`, following the exact style of `LEGACY_DATA_MANAGEMENT_ROLES` etc.:

```ts
export const LEGACY_EMPLOYEE_MANAGEMENT_ROLES = ['admin'] as const;
```

**Open decision for the implementer to make explicitly, not silently assume:** should `school` also manage employees (matching the broad admin≈school pattern used everywhere else in the legacy surface), or is provisioning staff accounts admin-only? This document defaults to **admin-only** because account/credential issuance is a materially more sensitive action than the data-management operations `school` already has (creating a login credential is not the same class of action as creating a bus record) — but this is a real product decision, not a technical constraint, and should be confirmed with whoever owns the product before implementation, not decided unilaterally in code.

## 7. Server-side behavior

### 7.1 — Login gate for disabled accounts

In `POST /api/auth/login`, after resolving `user` via `legacyUserRepository.findByEmail` and before password verification succeeds into a session: if `user.status === 'disabled'`, reject with a clear, distinct message (e.g. "هذا الحساب معطّل، يرجى التواصل مع الإدارة") and do **not** create a session. Decide deliberately whether this check runs before or after password verification — reflect on the enumeration trade-off (revealing "this account exists but is disabled" is different from the existing unknown-email/wrong-password generic message) and document the choice, don't leave it accidental.

Also thread `mustChangePassword` into the successful login response so the frontend can gate access (§8).

### 7.2 — `POST /api/admin/employees` (create)

Guard: `requireLegacyRole(authHeader, LEGACY_EMPLOYEE_MANAGEMENT_ROLES)`.

Request: `{ name, email, role }` where `role` is one of `'driver' | 'school' | 'admin'` (never `'parent'` — parents are self-service only, per §3). Validate `role` server-side against this exact allow-list; reject anything else with 400.

Behavior:
1. Reject if `email` already exists in `legacy_users` (same check `register` already does).
2. Generate a strong random temporary password — reuse the same `randomBytes` pattern already used for session tokens/device secrets/verification codes elsewhere in this codebase, not a new weaker generator.
3. Hash it with the existing `hashPassword` (scrypt+salt) convention — never store or log the plaintext temporary password anywhere.
4. Create the `legacy_users` row with `status: 'active'`, `mustChangePassword: true`, `createdByUserId: <the admin's own session user id>`.
5. Response: `{ success: true, employee: { id, name, email, role }, temporaryPassword: '<plaintext, shown exactly once> }`. Never persist the plaintext, never return it again from any other endpoint, never log it (matches the existing discipline in `ContactVerificationService.ts` and `deviceCredentials.ts`).
6. Do **not** create a session for the new employee — this is an admin action, not a login.

### 7.3 — Forced first-login password change

`POST /api/auth/change-password` already exists and already does the right things (verifies current password, enforces policy, revokes all sessions on success). Extend it minimally:
- On success, if `user.mustChangePassword` was `true`, clear it to `false` as part of the same update.
- No other behavior change — the existing "revoke all sessions including the caller's own, force a fresh login" decision (Phase 7H) still applies and is exactly right here too: the employee's temporary-password session gets revoked, and their next login (with their own new password) is real proof they completed the flow.

**Enforcement of the gate itself is a frontend responsibility (§8), not a new backend route-blocking mechanism** — every other legacy route stays behavior-identical; `mustChangePassword` is informational data the frontend must act on, not a new 403 the backend throws on unrelated routes. (Decide at implementation time whether this is sufficient, or whether a defense-in-depth backend block on other mutation routes while `mustChangePassword` is true is warranted — if so, treat it as a deliberate, documented addition, not an afterthought.)

### 7.4 — Activate / deactivate

`PATCH /api/admin/employees/:id/deactivate` and `PATCH /api/admin/employees/:id/activate`, both `LEGACY_EMPLOYEE_MANAGEMENT_ROLES`-guarded.

- Deactivate: set `status: 'disabled'`, then call the existing `invalidateAllSessionsForUser(id)` — an employee who gets deactivated mid-shift is logged out everywhere immediately, not just blocked from a future login.
- Activate: set `status: 'active'`. Does not touch `mustChangePassword` (an activated account keeps whatever that flag's value already was).
- Reject attempting to deactivate the caller's own account (an admin locking themselves out is a real, avoidable footgun) — decide the exact error semantics (400 vs 403) deliberately.
- Reject targeting a demo seed account (`u-1`..`u-4`) for deactivation, OR decide deliberately that this is allowed and document why — do not leave this as an accidental gap that could lock out the only working demo admin login.

### 7.5 — Credential reset (the "forgot password" substitute)

`POST /api/admin/employees/:id/reset-credential`, `LEGACY_EMPLOYEE_MANAGEMENT_ROLES`-guarded. Generates a new temporary password (same generation/hashing discipline as §7.2), sets `mustChangePassword: true`, revokes all existing sessions for that employee, and returns the new temporary password once — same one-time-disclosure discipline as creation.

### 7.6 — Assign / unassign driver ↔ bus

`PATCH /api/admin/buses/:id/assign-driver`, `LEGACY_EMPLOYEE_MANAGEMENT_ROLES`-guarded (or `LEGACY_DATA_MANAGEMENT_ROLES` if the admin/school-parity question in §6 resolves toward including `school` — same open decision applies here specifically since bus assignment is arguably closer to existing school-operational duties than credential issuance is).

Request: `{ driverId: string | null }`.
- `driverId: null` explicitly unassigns (bus reverts to the current "unassigned, `driverId` null" state Phase 7K already treats as legitimate).
- A non-null `driverId` must resolve to a real `legacy_users` row with `role === 'driver'` and `status === 'active'` — reject otherwise with a clear 400 (application-level validation, matching Phase 7K's own stated preference for "prefer application-level validation... that `bus.driverId` must reference a `legacy_users` row with `role='driver'`" over a SQLite trigger).
- Never accept `driverId` from an unrelated field, never let a client imply "assign me" by any means other than this explicit admin route.

### 7.7 — Assign / unassign parent ↔ student

`PATCH /api/admin/students/:id/assign-parent`, same guard family as §7.6. Request: `{ parentId: string | null }`. Same validation discipline: non-null `parentId` must resolve to a real `legacy_users` row with `role === 'parent'` and `status === 'active'`.

### 7.8 — `GET /api/admin/employees` (list)

`LEGACY_EMPLOYEE_MANAGEMENT_ROLES`-guarded. Returns `id, name, email, role, status, mustChangePassword, createdAt`. **Never** includes `passwordHash` — reuse `legacyUserRepository`'s existing shape discipline (it already never selects/returns the hash to any route).

### 7.9 — Standalone session revocation

`POST /api/admin/employees/:id/revoke-sessions`, same guard. Calls `invalidateAllSessionsForUser(id)` without touching `status`. Useful when an admin wants to force a re-login (e.g., suspected shared-device use) without disabling the account.

## 8. Frontend implications (plan only — do not build yet)

- **Forced-password-change gate:** the login response now carries `mustChangePassword`. `AuthModal`'s `onLoginSuccess` (or a new wrapper in `App.tsx`) must check this and, if `true`, render a blocking "set your new password" screen — no access to any portal until a successful `change-password` call clears it. This is a new piece of app-level routing state, not just a modal.
- **Admin "Employee Management" surface:** a new tab (most naturally alongside the existing `DataManagementModal.tsx` tabs — "الطلاب / الحافلات والسائقين / المسارات المدرسية") or a dedicated new modal: create-employee form (name, email, role picker restricted to driver/school/admin), a list of existing employees with activate/deactivate/reset-credential/revoke-session actions, and — critically — a **clear, non-dismissible one-time display of the temporary password** immediately after creation or reset (a copy-to-clipboard affordance, an explicit "you will not be able to see this again" warning), matching the seriousness of the same pattern already used for device secrets.
- **Ownership assignment UI:** a driver-picker on each bus row and a parent-picker on each student row (both already listed in `DataManagementModal.tsx`), calling §7.6/§7.7. Must only offer active employees of the correct role as options, sourced from `GET /api/admin/employees` — never a free-text field.
- Every new admin-only screen must be gated the same way the Data Management button itself now is (`canApprove` / an equivalent role check in `Header.tsx`) — do not repeat the earlier "visible to every role" gap this session just fixed.

## 9. Required test coverage (matching this project's established rigor)

A dedicated `tests/services/employeeManagement.test.ts` (or split by concern) covering at minimum:

- Employee creation: only admin (per §6's resolved decision) can create; `role` restricted to driver/school/admin, never parent; temporary password is high-entropy, hashed, never returned a second time from any other endpoint; `createdByUserId` recorded correctly.
- Login gate: a disabled account cannot log in even with the correct password; re-activating restores login; `mustChangePassword` correctly appears/disappears in the login response across the full create → first-login → change-password → re-login lifecycle.
- Deactivation revokes all existing sessions immediately (live-style test: session valid before, invalid immediately after, without a new login/logout in between).
- Credential reset: old password stops working, new temporary password works once, `mustChangePassword` is set, all prior sessions revoked.
- Ownership assignment: valid driver→bus and parent→student assignments succeed; assigning a non-driver to `driverId` or non-parent to `parentId` is rejected; assigning a disabled employee is rejected; unassignment (`null`) works; spoofed/cross-role attempts to self-assign are rejected.
- Source-scan tests: every new route calls the correct guard; no route reads `req.body.role`/`status`/`mustChangePassword` to bypass validation; no new file imports governed/Journey/PolicyEngine/ActionExecutor modules; the temporary password is never logged (`console.*`) anywhere in the new files.
- Migration correctness + seed idempotency (the recurring "new table/column forgotten by `clearAll()`" bug class — guard against it explicitly, as every phase that added persisted state has had to).
- Multi-instance verification: an employee created on process A is immediately usable (correct temp password, correct role) on process B; a deactivation on A is immediately enforced on B.

## 10. Explicit STOP conditions for the implementer

Stop and report — do not silently work around — if:

- The admin/school scope question in §6 cannot be resolved from existing conventions and requires a product decision (ask, don't guess).
- Enforcing `mustChangePassword` cleanly requires blocking routes in a way that conflicts with an existing test's expectations — surface the conflict, don't weaken the test.
- The baseline test count at the start of implementation does not match the number recorded at the end of this document's baseline phase.
- Any change would require touching the governed `users` table, `authz.ts`, or any governed domain service.
- A defensible way to prevent an admin from deactivating the last remaining active admin account cannot be found without inventing new state — report the gap rather than leaving the system lockable-out.

## 11. Success criteria

- An admin can create a new driver or school-staff account entirely inside the product, with zero email dependency.
- The new employee can log in with the temporary credential, is forced through a real password change before reaching any portal, and is fully functional afterward.
- An admin can deactivate an employee and see their access revoked immediately, everywhere, not just on their next login attempt.
- An admin can assign a real driver to a real bus and a real parent to a real student through the UI, with server-side role validation preventing nonsense assignments.
- Every one of the fixes made earlier this session (activeRole persistence, ParentPortal/DriverPortal ownership-leak fixes, MapView role scoping, the login/register role-escalation fix) continues to work exactly as before — this phase adds a new capability, it does not touch any of that surface.
- Full regression suite passes; the new test file's count is reported additively (baseline + new), never replacing or hiding the baseline.
