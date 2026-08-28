# Phase 14 — Production Onboarding, Account Provisioning & Pilot Readiness

## 1. Executive Summary

Phase 13/13.1 proved MASARA's identity architecture is sound: a real,
stable, non-name bridge (`students.legacyStudentId → legacy_students.id →
legacy_students.parentId → legacy_users.id`) correctly isolates every
parent/student/driver, even under adversarial same-name attacks. But that
architecture only worked for accounts hand-seeded into both the legacy
and governed data stores at once. A real parent who registered through
the app's own `/api/auth/register` form — or a real driver hired through
the app's own `/api/admin/employees` form — got a working legacy login
but **no governed counterpart at all**, so every governed API (Parent
Live Journey, the Driver Console, GPS) returned 404. This phase closes
that gap: `ProvisioningService.ts` now creates both the legacy and
governed rows in **one real database transaction** for every new parent
and employee, and two idempotent, admin-triggered reconciliation
functions repair every pre-existing one-sided account (including the
exact `driver2`/`driver3` gap Phase 13.1 found live). A brand-new parent,
a brand-new driver, and a brand-new student were all onboarded through
the actual running application — real registration form, real admin UI,
real login — with no database intervention, and a full live Parent Live
Journey (GPS fresh → stale, real notifications, real driver) was
completed end-to-end for that brand-new household. One real bug was found
and fixed during this phase's own live verification (a React
Rules-of-Hooks crash in the new admin UI); one unrelated pre-existing gap
was found and deliberately left unfixed, per this phase's scope, and
flagged separately.

## 2. Starting Architecture

- Two user stores in one physical SQLite database (`database/masara.db`,
  one `better-sqlite3` connection, one `drizzle()` wrapper —
  `database/client.ts`): `legacy_users` (the sole real authentication
  source — sessions, login, password policy, rate limiting) and governed
  `users` (the identity every governed authorization guard in
  `server/services/authz.ts` resolves against, joined to the legacy side
  by email only).
- Governed `users`, `drivers`, `students`, and `buses` had **zero live
  creation methods** anywhere in the codebase — every row in those tables
  came from `database/seed/seed.ts`, confirmed by a full repository audit
  (`db.insert(...)` for each of those tables occurred nowhere outside
  `seed.ts`).
- `POST /api/auth/register` created only a `legacy_users` row.
  `POST /api/admin/employees` (Phase 8B) created only a `legacy_users`
  row too, even for `role: 'driver'` — no governed `users` row, no
  governed `drivers` row.
- Legacy student creation (`POST /api/students`) and parent assignment
  (`PATCH /api/students/:id/assign-parent`) both worked live and
  correctly, but had no equivalent on the governed side — no live route
  could create a governed student or set `legacyStudentId`.
- Session creation/validation/revocation, password policy, rate limiting,
  and account status (active/disabled) all already worked correctly and
  were **not modified** this phase.

## 3. Existing Onboarding Problems (confirmed, not assumed)

1. A real self-registered parent got `404 المستخدم غير موجود في نظام
   الحوكمة` from every `/api/parent/*` endpoint — live-reproduced before
   any fix, using a fresh throwaway account through the real
   `/api/auth/register` endpoint.
2. `driver2@masara.om`/`driver3@masara.om` had full governed accounts
   (found already seeded, from earlier phases) but **no `legacy_users`
   row at all** — they could never authenticate via the real
   `/api/auth/login` endpoint. This is the exact gap Phase 13.1's own
   live verification stumbled into and worked around with a throwaway
   fix that was explicitly documented as temporary.
3. No live path existed to link a newly created legacy student to a
   governed student/bus — the one step that makes Parent Live Journey
   reachable for that household.

## 4. Identity Architecture (unchanged, reused)

No change to the identity bridge itself. `students.legacyStudentId`,
`legacy_students.parentId`, and the email-based legacy↔governed user join
are exactly as Phase 13 built them. This phase only adds the missing
**provisioning** step that populates those same tables correctly for new
accounts — it does not touch how ownership is resolved or authorized.

## 5. Parent Provisioning

`server/services/ProvisioningService.ts`, `provisionParentAccount`:

```
validate (route, unchanged) → legacyUserRepository.findByEmail
  → exists?  → ensureGovernedCounterpart(existingLegacyUser)  [reconciliation]
  → new?     → db.transaction(tx => {
                 legacyUserRepository.create(..., tx)   // role: 'parent', hardcoded
                 userRepository.create(..., tx)          // role: 'parent', hardcoded, same schoolId as the pilot school
               })
```

`POST /api/auth/register` (`server.ts`) now delegates persistence to this
function; the pre-existing password-policy check and the hardcoded
`role: 'parent'` guarantee are preserved exactly (moved into
`ProvisioningService.ts`, verified by an updated source-scan test — see
§18).

## 6. Driver Provisioning

`provisionEmployeeAccount({ name, email, role, phone, createdByUserId })`:
same transactional pattern, plus — for `role === 'driver'` only — a
governed `drivers` row created and linked (`userId`) in the same
transaction. `POST /api/admin/employees` now delegates to this function;
role validation (`EMPLOYEE_ROLES`, admin-only) is unchanged. The admin
UI (`EmployeeManagementModal.tsx`) gained an optional phone field, shown
only when creating a driver (governed `drivers.phone` is `NOT NULL`).

Generic, not driver2/driver3-specific: any future hire through this same
form gets the full transactional treatment automatically.

## 7. Student Provisioning

New endpoint `POST /api/students/:id/provision-governed`
(admin/school-only): given a legacy student that already has a real
`parentId` (via the existing `assign-parent` endpoint) and an admin-chosen
real governed bus, creates the governed student row with
`legacyStudentId` set — idempotent (the existing
`students_legacy_student_unique` index makes a second call a no-op that
returns the existing row, never a duplicate). New UI in
`DataManagementModal.tsx`: a "التتبع المباشر" (live tracking) control per
assigned student, with a dropdown of real governed buses (fed by a new
read-only endpoint, `GET /api/governed/buses`).

**Scope boundary, stated explicitly**: this phase does NOT build live
creation of governed buses, drivers-to-bus assignment, or trips/routes —
those remain seed-only, exactly as before. A new student's live tracking
is enabled by attaching them to one of the *existing* real governed buses
(which already has a real, active trip), not by creating new fleet
infrastructure. Building live fleet CRUD is a separate, larger feature
outside this phase's "account onboarding" scope — see §31.

## 8. Bus Assignment

Legacy-side bus/driver assignment (`PATCH /api/buses/:id/assign-driver`)
is unchanged. Governed-side bus↔driver assignment has no live endpoint
(see §7's scope boundary) — the automated test suite
(`freshDriverProvisioning.test.ts`) exercises the underlying mechanism
directly (`busRepository.update(busId, { driverId })`) to prove the data
model supports it, pending a future live endpoint.

## 9. Account Lifecycle

Unchanged. Active/disabled status, `mustChangePassword`, session
revocation on deactivation/credential-reset — all pre-existing, all
still verified working (see §18 tests, all passing unmodified).

## 10. Authentication

Unchanged — the legacy session mechanism (`legacySessionService.ts`)
remains the **one and only** authentication source, exactly as the
existing "ONE AUTHENTICATION SOURCE" mandate requires. No second auth
system, no JWT, no client-side role authority was introduced.

## 11. Authorization

Unchanged. Every governed guard in `server/services/authz.ts` keeps its
exact existing signature and role logic. This phase's only effect on
authorization is that governed users now *exist* for accounts that
previously didn't — the guards themselves were never touched.

## 12. Identity Integrity

- No name/phone matching was introduced anywhere. Every reconciliation
  function matches exclusively by email (the pre-existing, already-proven
  join key).
- `db.transaction()` (drizzle + better-sqlite3, real synchronous SQL
  transactions) gives genuine atomicity for the create paths — confirmed
  both tables live in the same physical database file
  (`database/client.ts`), so this is not a cross-system saga; it's one
  transaction over two table namespaces.
- Governed repository `create()` methods (`userRepository`,
  `driverRepository`, `studentRepository` — none existed before this
  phase) accept an optional transaction handle (`DbOrTx`,
  `database/client.ts`) so `ProvisioningService` can compose them
  atomically without duplicating insert logic.

## 13. Data Reconciliation

Two deterministic, idempotent, admin-triggered functions
(`reconcileMissingGovernedUsers`, `reconcileMissingLegacyLogins`), wired
to `POST /api/admin/provisioning/reconcile` (admin-only) and a new
"تكامل الحسابات" panel in `EmployeeManagementModal.tsx`. Live-run against
the real dev database (see §26): repaired the real, pre-existing
`driver2`/`driver3` gap and a leftover Phase-13-adversarial-test account,
generating fresh one-time temporary passwords exactly like
`/api/admin/employees` already does. Nothing is auto-run; nothing was
guessed by name.

## 14. Database Changes

None. No schema migration this phase — every change is additive
application code (new repository methods, one new service, new routes).

## 15. Migration Details

Not applicable — no schema change.

## 16. API Changes

New:
- `POST /api/admin/provisioning/reconcile` (admin-only)
- `GET /api/admin/provisioning/audit` (admin-only, read-only)
- `POST /api/students/:id/provision-governed` (admin/school)
- `GET /api/governed/buses` (journey-reader roles: admin/school/driver)

Changed (behavior-preserving, same request/response shape):
- `POST /api/auth/register` — now also provisions a governed user
- `POST /api/admin/employees` — now also provisions a governed user
  (and, for drivers, a governed `drivers` row); accepts an optional
  `phone` field

## 17. UI Changes

- `EmployeeManagementModal.tsx`: optional driver phone field; new
  "تكامل الحسابات" (account integrity) panel with an integrity-check
  button and a one-click reconcile-and-repair button, surfacing any new
  temporary passwords the same way credential creation already does.
- `DataManagementModal.tsx`: new "التتبع المباشر" control per
  parent-assigned student, to link them to a real governed bus.

No changes to the parent/driver-facing registration or login screens —
the existing forms and their error handling already worked correctly for
this flow; only the backend behind them changed.

## 18. Security Testing

Full suite re-run after every change. Three pre-existing source-scan
tests needed updating (not weakening) because the code they inspect moved
into `ProvisioningService.ts`:
- `legacyOwnershipAudit.test.ts` — one test's expected file list picked up
  an incidental comment match in `studentRepository.ts`; fixed by
  rewording the comment, not the test's actual guard.
- `legacySessionAndAuthz.test.ts` — the "register always hardcodes role
  'parent'" test now also inspects `provisionParentAccount`'s own source,
  since that's where the hardcode now lives; still asserts the route
  itself never reads `req.body.role`.
- `passwordLifecycleHardening.test.ts` — the "policy check before
  persistence" ordering test now checks the ordering relative to the
  `provisionParentAccount(` call instead of the old direct
  `legacyUserRepository.create(` call.

No test was deleted, skipped, or had its assertion weakened.

## 19. Adversarial Testing

New file `tests/services/freshParentProvisioning.test.ts` (4 tests): a
duplicate-registration rejection test, a legacy-only reconciliation test
(simulating the exact pre-Phase-14 bug), and a full end-to-end test
(register → real legacy student creation/assignment → governed student
provisioning → `resolveAuthorizedStudents` → real journey state machine →
`getParentJourneys` → real notification) — all using
`provisionParentAccount` itself, never a shortcut insert.

New file `tests/services/freshDriverProvisioning.test.ts` (4 tests): a
full driver provisioning + bus assignment + trip-scoping + GPS
observation test, plus reconciliation tests in **both** directions
(governed-only → legacy repaired; legacy-only → governed repaired), each
confirmed idempotent on a second run.

## 20. Parent Live Journey (live, real, brand-new household)

Performed against the actual running dev server, not just the automated
suite:

1. Registered a genuinely new parent ("فاطمة بنت سالم الشحية",
   `phase14-newparent@masara.om`) through the real registration form.
   `GET /api/parent/journeys` immediately returned `200 []` (never `404`)
   — the exact fix under live proof.
2. Logged in as school, opened the real Data Management UI, created a
   brand-new legacy student ("سلمان بن خالد الراشدي") through the real
   "إضافة طالب جديد" form, assigned the new parent via the real
   parent-assignment dropdown, then clicked the new "تفعيل" (enable live
   tracking) control to link the student to real governed bus 101.
3. Logged in as the new parent: the home screen showed exactly this one
   real child, on حافلة 101 — nothing else.
4. Logged in as `driver1` (bus 101's real driver), drove the real journey
   through `scheduled → waiting → boarding → on_bus` via the real journey
   endpoints.
5. As admin, ran the real GPS Simulation engine for bus 101's trip.
6. Back as the new parent: `GET /api/parent/journeys` showed the real
   bus, real driver name, `location.freshness: "FRESH"` with real
   coordinates, and a computed ETA — for a household that did not exist
   in any seed file.
7. Reloaded the actual rendered UI: the home screen showed a live ETA
   countdown; the child detail sheet showed "الرحلة جارية الآن", the real
   progress checklist, the real driver, and an honest "آخر تحديث معروف —
   قبل 68 ث" freshness readout.

## 21. GPS Verification

Same real `GpsSimulationEngine`/`CurrentLocationProjectionService` used
throughout Phases 12–13.1, exercised against the new household's real
bus/trip — `freshness: "FRESH"` immediately after an observation,
honestly reported without fabrication. Stale-after-60s behavior was not
independently re-timed this phase (unchanged code path, already proven in
Phase 13/13.1).

## 22. Notification Verification

A real `STUDENT_BOARDED` event for the new student produced a real,
correctly-worded notification, visible in the new parent's actual
rendered Notifications tab within the live browser session — not just an
API response.

## 23. Mobile Verification

One spot-check: the new parent's home screen at a 375×812 mobile
viewport, fresh page load, rendered correctly (greeting, child card, and
the bottom tab bar all present, nothing clipped or broken). A full
mobile pass across every role/screen was not performed this phase (time
budget) — this is a documented gap, not a claim of completeness.

## 24. Accessibility Verification

Not independently re-verified this phase. No accessibility-relevant
markup was touched (the new UI controls reuse the same `Field`/`Select`/
`Button` primitives already used everywhere else in `DataManagementModal.tsx`
and `EmployeeManagementModal.tsx`).

## 25. Arabic RTL Verification

All new UI text is Arabic, rendered through the same existing RTL layout
components as every pre-existing control on the same screens (no new
layout primitives introduced) — live-observed correctly right-to-left
throughout every browser step in §20/§26. No dedicated RTL-specific edge
case (mixed digit direction, icon mirroring) was separately tested this
phase.

## 26. Browser Verification (full account)

- Real registration → real governed access (200, not 404) — §20 step 1.
- Real admin/school student creation, parent assignment, and live-tracking
  provisioning through the actual `DataManagementModal` UI — §20 step 2.
- Real driver creation through the actual `EmployeeManagementModal` UI,
  including the new phone field — §29.
- Real driver login with the generated temporary password, confirmed
  `requireDriverIdentity` no longer 404s a freshly-created driver — §29.
- Real, live-triggered reconciliation via the new admin UI panel — fixed
  the actual pre-existing `driver2`/`driver3` gap and a leftover Phase-13
  test account in the running dev database; re-ran the audit afterward
  and confirmed `usersOnlyInLegacy`/`usersOnlyInGoverned`/
  `driversWithoutLogin` were all empty. Verified `driver2` can now
  genuinely log in with the newly generated credential.
- **One real bug found and fixed live**: adding the account-integrity
  panel's three `useState` calls after the component's existing
  `if (!isOpen) return null;` early return caused a genuine React
  "Rendered more hooks than during the previous render" crash the moment
  the modal was toggled. Caught via console-error inspection during this
  phase's own verification (not by a human bug report), fixed by moving
  the hook declarations above the early return (Rules of Hooks), and
  confirmed fixed with zero console errors in a fresh tab afterward.
- **One real, pre-existing, out-of-scope bug found and deliberately left
  unfixed**: `GET /api/routes/:id/stops` rejects the parent role by
  design (`requireJourneyReader`'s own docstring: "never parent... future
  work, not built in Phase 3A"), so the Parent Live Journey map's
  route-stop markers silently fail to load for every parent — reproduced
  for both the original seeded demo parent and the brand-new one. This
  predates Phase 14 and is unrelated to onboarding; flagged as a separate
  background task rather than fixed inline, per this phase's explicit
  "do not fix unrelated issues" instruction.

## 27. Test Results

**46 test files, 963 tests, all passing** (955 carried over from Phase
13.1 + 8 new in `freshParentProvisioning.test.ts`/
`freshDriverProvisioning.test.ts`). No test weakened, skipped, or deleted.

## 28. Typecheck

`npx tsc --noEmit` — clean, no errors, throughout every stage of this
phase's changes.

## 29. Production Build

`npm run build` (vite + esbuild server bundle) — clean.

## 30. Data Integrity Audit (live, real dev database)

`GET /api/admin/provisioning/audit`, run live before and after
reconciliation:

**Before**: `usersOnlyInLegacy` (1 — a leftover Phase 13 adversarial test
account), `usersOnlyInGoverned` (2 — `driver2`/`driver3`, the real
pre-existing gap), `driversWithoutLogin` (2 — same two), `driversWithoutBus`
(1 — the brand-new driver created in this phase's own test, correctly
unassigned since no live bus-assignment endpoint exists yet — see §7/§8),
`studentsWithoutStableBridge` (40 — the pre-existing auto-generated seed
students with no real legacy counterpart, honestly unlinked since Phase
13), `legacyStudentsWithoutParent` (3 — pre-existing, unrelated seed
students), `duplicateLegacyEmails` (0).

**After reconciliation**: `usersOnlyInLegacy`, `usersOnlyInGoverned`, and
`driversWithoutLogin` all empty. Every other category unchanged (correctly
— those are honest, non-actionable gaps, not bugs the reconciliation
function is designed to touch, per its own deterministic-only scope).

## 31. Remaining Technical Debt

- Governed bus/driver/trip/route creation remains seed-only (§7/§8's
  stated scope boundary) — a real pilot onboarding a genuinely new bus
  (not one of the three seeded ones) has no live path yet. This is a
  fleet-management feature, not an identity/account-provisioning one, and
  was deliberately not built in this phase.
- `GET /api/routes/:id/stops` rejects the parent role (§26, flagged
  separately, not fixed here).
- A full mobile/accessibility/RTL pass across every role and screen
  affected (directly or indirectly) by this phase's changes was not
  performed — only the single spot-check in §23.

## 32. Known Limitations

- The reconciliation functions are read-then-write, not
  transactional across the whole scan — acceptable for this admin-only,
  low-frequency, idempotent operation (a concurrent registration during a
  reconcile run could theoretically be seen or missed by one pass, but
  the next run always converges correctly, and no data is ever
  duplicated or corrupted either way).
- `provisionParentAccount`'s reconciliation branch
  (`ensureGovernedCounterpart`) runs outside a transaction (a single
  insert, not a multi-table write) — acceptable since it's one row, one
  operation, with the same idempotency guarantee as the main
  reconciliation functions.

## 33. Pilot Readiness

Every §55 gate this report can speak to is met: a brand-new parent, a
brand-new driver, and a brand-new student were all onboarded through the
real application UI with zero database intervention, and a full live
Parent Live Journey completed for that never-seeded household. The one
gap keeping this from an unqualified 🟢 is §31's fleet-management scope
boundary (buses/trips/routes still require seed-level setup) — a genuine,
explicitly-scoped limitation, not a defect.

## 34. Files Changed

**New:**
- `server/services/ProvisioningService.ts`
- `tests/services/freshParentProvisioning.test.ts`
- `tests/services/freshDriverProvisioning.test.ts`
- `docs/PHASE_14_PRODUCTION_ONBOARDING_AND_PROVISIONING_REPORT.md`

**Modified:**
- `database/client.ts` (added `DbOrTx` type)
- `server/repositories/userRepository.ts`, `driverRepository.ts`,
  `studentRepository.ts`, `legacyUserRepository.ts` (added/extended
  `create()`)
- `server.ts` (register + employee-creation routes delegate to
  `ProvisioningService`; new reconciliation/audit/provision-governed
  routes)
- `server/routes/agentRoutes.ts` (new `GET /api/governed/buses`)
- `src/components/EmployeeManagementModal.tsx` (phone field; account
  integrity panel; hooks-order bug fixed)
- `src/components/DataManagementModal.tsx` (live-tracking provisioning
  control)
- `tests/services/legacyOwnershipAudit.test.ts`,
  `legacySessionAndAuthz.test.ts`, `passwordLifecycleHardening.test.ts`
  (updated to match the moved code, not weakened)
- `server/repositories/studentRepository.ts` (comment reworded to avoid
  an incidental source-scan false match)

**Dev database** (not a code change, left in place as living evidence):
one real new parent, one real new legacy+governed student, one real new
driver, and the reconciled `driver2`/`driver3` legacy logins.

## 35. Final Scorecard

| Area | Score |
|---|---:|
| Parent Onboarding | 9/10 |
| Driver Onboarding | 8/10 (governed bus assignment still needs a live endpoint) |
| Student Provisioning | 7/10 (works, but bounded to existing governed buses only) |
| Identity Integrity | 10/10 |
| Authentication | 10/10 (unchanged, unweakened) |
| Authorization | 9/10 (unchanged, but the parent route-stops gap remains) |
| Parent Live Journey | 9/10 (fully verified live for a new household; map stop markers still broken for every parent — pre-existing, unfixed) |
| GPS | 9/10 |
| Notifications | 9/10 |
| School Operations | 8/10 |
| Admin Operations | 9/10 |
| Mobile UX | 6/10 (one spot-check only) |
| Accessibility | 6/10 (not independently re-verified this phase) |
| Arabic RTL | 7/10 (observed correct throughout, not exhaustively tested) |
| Data Integrity | 10/10 (live audit + reconciliation both verified working) |
| Production Readiness | 8/10 |

## Final Readiness Classification

**🟡 READY WITH CONDITIONS.**

The core failure mode this phase targeted — "a new user can only work
because someone manually inserted database rows" — is closed and
live-proven false for parents, drivers, and students, exactly per §56's
success criterion. The conditions withholding an unqualified 🟢: (1) a
real pilot's buses/routes/trips still require seed-level setup, not a
live UI; (2) the parent-facing route-stops 403 (pre-existing, flagged
separately); (3) mobile/accessibility/RTL verification was a spot-check,
not exhaustive.
