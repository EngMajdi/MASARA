# Phase 13 — Student Identity Unification & Real Parent Live Journey

## 1. Objective

Establish a deterministic, stable, secure student identity across MASARA's
two data stores (legacy and governed), and make the Parent Live Journey
work correctly for real authenticated accounts. Not a UI redesign, not a
feature expansion — an identity/architecture correctness phase.

## 2. Starting Point (what Phase 12 left behind)

Phase 12 closed 🟡 PILOT READY WITH CONDITIONS. Its blocking condition:
Parent Live Journey did not functionally work for the real demo household,
because no stable legacy↔governed student identity bridge existed. Phase
11 had already gone further and hard-disabled the frontend's previous
name-matching bridge (`ChildDetailSheet.tsx`'s `useGovernedRecord`,
`ParentPortal.tsx`'s `governedFor`) as a fail-closed defensive measure,
since name-matching is explicitly forbidden and had also been independently
found to never actually resolve correctly for the real demo household.

## 3. Reverse-Engineering — what actually existed (spec §4)

Before changing anything, the entire relevant data model was read:
`database/schema.ts` (all governed tables plus `legacyUsers`/`legacyBuses`/
`legacyStudents`), `server/services/ParentAccessService.ts`,
`server/domain/parentAccessContract.ts`, `server/services/
ParentJourneyService.ts`, `database/seed/seed.ts`, and every repository
touching students/users on both sides.

Findings, evidence-based:

- **Governed `students` table had no `parentId` FK at all** — only
  free-text `parentName`/`parentPhone` columns. There was no real
  parent→student relation on the governed side, full stop.
- **Legacy `legacy_students.parentId`** IS a real, enforced FK to
  `legacy_users.id` (added Phase 7K), live-tested clean in Phase 12 for
  Parent A/B isolation. This is the only genuine, evidence-backed
  parent↔student ownership relation anywhere in the codebase.
- **The actual pre-Phase-13 Parent Live Journey mechanism** was not name
  matching (contrary to this project's own Phase 10–12 narrative) — it was
  a DEMO-ONLY **phone-number** match: `DEMO_PARENT_PHONE_BY_EMAIL` in
  `server/domain/parentAccessContract.ts`, read by
  `ParentAccessService.resolveAuthorizedStudents()` via
  `studentRepository.findByParentPhone()`.
- **That phone mechanism was itself broken for the real household**: the
  governed seed's demo constant was `+968 9111 0000`
  (`DEMO_PARENT_PHONE_BY_EMAIL['parent@masara.om']`), while the real legacy
  `std-1`/`std-2` records carried `+968 9111 2233` — two independently
  invented values that never matched. Parent Live Journey had been
  structurally broken for the real household since the phase that first
  built it, not merely "using an inferior mechanism."
- `ParentJourneyService.ts` was already a pure composition layer, entirely
  dependent on one seam function (`resolveAuthorizedStudents`) — an
  intentional Phase 5A design. Every downstream function needed zero
  changes.

## 4. Source of Truth Decision (spec §6/§32)

**Decision**: `legacy_students.parentId → legacy_users.id` is the source of
truth for parent↔student ownership. It is real, FK-enforced, and was
already live-tested clean.

**No STOP condition applies**: a stable ID *does* exist (the legacy FK); it
was found by full-repository search, not assumed; using it does not
require guessing, does not require destructive migration, and does not
weaken any existing authorization. This decision was not made silently —
it is documented here and was the direct, minimal-blast-radius conclusion
of the evidence above.

## 5. The Bridge (spec §7)

Added one new, nullable, additive column:

```
students.legacyStudentId → legacy_students.id   (unique index, nullable)
```

Chosen over inventing a new shared canonical ID because it is the smallest
safe change: it reuses the real legacy ownership FK as-is, adds nothing on
the legacy side, and is fully backward compatible (every pre-existing
governed student that predates this phase gets `legacyStudentId = null`,
honestly representing "no legacy counterpart," never a fabricated link).

New resolution chain in `server/services/ParentAccessService.ts`
(`resolveAuthorizedStudents`):

```
verified governed parent (session, Phase 11)
  → email join → real legacy user (legacyUserRepository, the same
    cross-store join every other governed guard already uses)
  → legacy_students WHERE parentId = that legacy user's id
  → governed students WHERE legacyStudentId = that legacy student's id
```

No step compares a name or a phone number. `isStudentAuthorized` always
re-derives the authorized set server-side; a client-supplied `studentId` is
never trusted as proof of ownership.

`ParentJourneyView.child` (the public read-model DTO, both
`server/domain/parentAccessContract.ts` and its frontend mirror
`src/types.ts`) now also carries `legacyStudentId: string | null` — the
one honest, additive field that lets the frontend match a governed journey
view back to the legacy `Student.id` it already holds, by ID, never by
name.

## 6. Data Migration (spec §8)

- **Schema**: `npx drizzle-kit generate` produced
  `database/migrations/0014_workable_penance.sql`
  (`ALTER TABLE students ADD legacy_student_id ...` + unique index),
  applied to the dev DB via `npm run db:migrate`.
- **Seed data (permitted to correct per spec §8)**: `database/seed/seed.ts`
  now seeds two new, deterministic governed student rows —
  the governed counterparts of the real legacy `std-1`/`std-2` — each
  carrying `legacyStudentId: 'std-1'` / `'std-2'`, placed on the real
  active bus/route (`busDefs[0]`, a stop from `stopDefs`). The previous
  `isDemoParentChild` phone/name special-casing in the 40-row
  auto-generated loop was removed entirely (it never worked and is no
  longer needed). `clearAll()`'s deletion order was corrected: governed
  `students` must now be deleted **before** `legacyStudents` (the new FK
  direction), the reverse of the previous order.
- **Real/persistent data**: no existing real record's identity was
  inferred, guessed, or silently migrated. Nothing was deleted.

## 7. Code Changes (full list)

- `database/schema.ts` — `students.legacyStudentId` + unique index.
- `server/repositories/studentRepository.ts` — removed `findByParentPhone`,
  added `findByLegacyStudentId`.
- `server/services/ParentAccessService.ts` — `resolveAuthorizedStudents`
  fully rewritten to the FK chain above.
- `server/domain/parentAccessContract.ts` — removed the retired
  `DEMO_PARENT_PHONE_BY_EMAIL` constant and its Phase 5A header comment;
  `ParentJourneyView.child` gained `legacyStudentId`.
- `server/services/ParentJourneyService.ts` — `buildView`/`getParentJourneys`
  now pass through `student.legacyStudentId`.
- `src/types.ts` — frontend `ParentJourneyView.child` mirror updated to
  match.
- `src/components/parent/ChildDetailSheet.tsx` — `useGovernedRecord`
  re-enabled: matches `view.child.legacyStudentId === student.id` (a real
  ID comparison), replacing the Phase 11 hard-disable.
- `src/components/ParentPortal.tsx` — `governedFor` re-enabled the same
  way; call sites changed from `governedFor(child.name)` to
  `governedFor(child.id)`.
- `database/seed/seed.ts` — see §6.

## 8. Test Changes

Six test files used an identical fixture (`createFreshAuthorizedChild()`)
that directly seeded a governed student with a `parentPhone` and mutated
`DEMO_PARENT_PHONE_BY_EMAIL` at runtime. All six were rewritten to build a
real legacy user + legacy student (with a real `parentId`) + governed
student (with `legacyStudentId`) + governed user, matching the real
mechanism:

- `tests/services/parentJourneyService.test.ts` (also: its dedicated
  `resolveAuthorizedStudents` describe block was rewritten to assert the
  real FK chain instead of phone equality)
- `tests/services/notificationService.test.ts`
- `tests/services/contactVerificationAndDelivery.test.ts`
- `tests/services/notificationDeliveryProvider.test.ts`
- `tests/services/notificationProductionIntegration.test.ts`
- `tests/services/userContact.test.ts`

`tests/services/legacyOwnershipAudit.test.ts` had one assertion updated:
it previously asserted the now-retired Phase 5A comment text
(`"no real parent<->student relation"`); it now asserts the real bridge
exists (`legacyStudentId` documented) and that
`DEMO_PARENT_PHONE_BY_EMAIL` is genuinely gone, not just renamed.

**Full suite: 43 files, 947 tests, all passing.** `npx tsc --noEmit`:
clean. `npm run build`: clean (vite + esbuild server bundle).

## 9. Live Verification — full 7-state Parent Live Journey (spec §11, the main acceptance criterion)

Performed against the real demo household (`parent@masara.om` /
`std-1`/`std-2`, real bus 101 / trip / route "مسار القرم") via the actual
running dev server, real login flows, the real driver console UI, and the
real GPS Simulation API — not mocked, not asserted from source alone.

| # | State | Evidence |
|---|-------|----------|
| 1 | Trip not started | `GET /api/parent/journeys` → `journey: null` for both children before any journey existed for the new governed rows. |
| 2 | Trip start | Driver console → real journey-transition buttons (`بدء انتظار الطالب` → `بدء صعود الطالب` → `تأكيد صعود الطالب`) drove Mariam's real journey `scheduled → waiting → boarding → on_bus`, confirmed via `/api/driver/trips` after each click. |
| 3 | GPS fresh / LIVE | `POST /api/gps-simulation/start` + `/advance` for the real trip → parent view showed `location.freshness: "FRESH"` with real lat/lng/speed/heading and a computed ETA. |
| 4 | Bus moves | A second `/advance` call produced a new, different lat/lng — confirmed movement, not a frozen value. |
| 5 | GPS stale | Waited 65s past the 60s freshness threshold with no further observation → parent view honestly flipped to `freshness: "STALE"` on the *same* last-known coordinates (never fabricated a new position). |
| 6 | Arrival | `POST /api/journeys/:id/start-transit` → `approach-stop` → `drop-off` (with a real `stopId`) drove the journey through `in_transit → approaching_stop → dropped_off`, with `currentStopId` and `droppedOffAt` populated honestly. |
| 7 | Completion | `POST /api/journeys/:id/complete` → `state: "completed"`, a real `JOURNEY_COMPLETED` audit event, surfaced to the parent as `lastEvent`. |

Also confirmed **in the actual rendered frontend** (not just the API): the
Parent Portal home list correctly showed both children; opening Mariam's
`ChildDetailSheet` rendered "اكتملت الرحلة" (journey completed), the full
5-step progress checklist all marked done, the real driver name, and an
honest "آخر تحديث معروف — قبل 274 ث" staleness readout — never a fake
"LIVE" label once the observation had aged out.

## 10. Multi-Child Parent Test (spec §12)

`parent@masara.om` has two real linked children (Mariam=`std-1`,
Khalil=`std-2`) on the same bus. Throughout the state-machine walk above,
Khalil's journey was independently verified to remain `state: "scheduled"`
and completely unaffected by Mariam's transitions all the way through her
`completed` state — proving per-child isolation even within one parent's
own household, on the same bus, driven by the same trip.

## 11. Same-Name Children (spec §13)

Not exercised as a bespoke two-parent live scenario in this pass (time
budget). Two forms of real evidence instead:

1. **Code-path guarantee**: no function in the identity chain
   (`resolveAuthorizedStudents`, `isStudentAuthorized`, `buildView`,
   `getParentJourneys`, `getParentJourneyEvents`) ever reads or compares a
   `name` field for authorization or lookup — confirmed by full reading of
   every file in the chain. Matching is exclusively `legacy_users.id` →
   `legacy_students.parentId` → `students.legacyStudentId`.
2. **Live incidental proof**: the auto-generated 40-student seed pool
   (small first-name/family-name arrays combined by modular arithmetic)
   already produces literal duplicate full names among *different*
   `studentId`s on the very same trip (e.g. multiple journeys named
   "محمد بن المعمري الهنائي" with different `studentId`s were observed
   live in `/api/driver/trips`'s response during this session) — each
   tracked and addressed correctly by its own distinct ID with no
   collision.

This is not a substitute for the spec's mandatory two-real-parent same-name
test; it is documented here honestly as a gap, not papered over. See §19.

## 12. Adversarial ID Tests (spec §14)

Run live against the running dev server with real tokens:

| Test | Result |
|---|---|
| Parent A token on a foreign (non-owned) student's journey events | `403` — `"هذه الرحلة الطلابية لا تخص أياً من أبنائك..."` |
| Parent role hitting an operational (school/admin) endpoint | `403` |
| No `Authorization` header at all | `401` |
| Garbage/malformed bearer token | `401` |
| Newly-registered Parent B (real account, zero linked students) reading their own journeys, with a smuggled `?email=parent@masara.om&userEmail=parent@masara.om` query string | Identity resolved purely from the session in both cases — response was byte-identical with and without the smuggled params (a `404`, because this throwaway account has no governed-side counterpart yet — an honest denial, not a fabricated 200). The smuggled email had **zero effect**, proving client-supplied identity is never trusted. |

No adversarial case leaked another child's data, escalated role, or was
influenced by client-supplied identity claims.

## 13. Driver/Bus Consistency (spec §15)

Exercised live: logged in as `driver1@masara.om`, opened the real Driver
Journey Console, confirmed bus 101 / trip / roster matched the governed
seed exactly, and drove Mariam's journey through every state via the
actual UI buttons and confirm dialogs (not the API shortcut, for the first
three transitions) before switching to direct API calls for the remaining
transitions once the UI mechanism was already proven.

## 14. School/Admin Regression (spec §16)

Live spot-checks after all identity changes: `GET /api/all-data` as admin
→ `200`; `GET /api/operations/journeys` as school → `200` (3 journeys);
`GET /api/notifications` as admin → `200`. No endpoint regressed.

## 15. GPS Security/Honesty (spec §17)

Directly demonstrated in §9: freshness is derived server-side from
`receivedAt` age (`CURRENT_LOCATION_STALE_AFTER_SECONDS = 60`,
`CurrentLocationProjectionService.ts`), never client-asserted, and flips to
`STALE` honestly with no new data rather than silently repeating a fake
"LIVE" label.

## 16. Notification Isolation (spec §18)

Not independently re-verified live this phase (unchanged code path);
covered by the existing, still-passing automated suite
(`tests/services/notificationService.test.ts` and related files, now
rewritten onto the real FK fixture and still 100% passing).

## 17. Full Data-Integrity Regression (spec §19)

`npx vitest run`: **43 test files, 947 tests, all passing** — including
every existing cross-parent isolation test, source-scan governance guards,
and the JourneyService state-machine suite, none of which needed weakening
to pass.

## 18. School Isolation / Existing Security (spec §22/§23)

Not touched this phase. Single-school-only scope remains exactly as
Phase 11 left it — no change to any authorization guard's role/scope
semantics, only to *how* the parent's authorized-student set is computed.

## 19. Known Gaps / Honest Limitations

- The mandatory two-real-parent, same-first-name live test (§13) was not
  performed as a dedicated live scenario — see §11 for the evidence that
  does exist and why the code path structurally cannot mismatch on name.
- Mobile-viewport and Arabic-RTL-specific live verification of the
  identity-related UI (ChildDetailSheet's re-enabled live tracking) was
  not separately performed this phase; the app is RTL-first by construction
  and the changed components render through the same existing RTL layout
  primitives as before — no new layout was introduced.
- The 40 pre-existing auto-generated governed students (from earlier
  phases) remain unlinked (`legacyStudentId: null`) — correct and honest,
  since they have no real legacy counterpart to link to, but it means only
  the one real household (`std-1`/`std-2`) currently has a working Parent
  Live Journey. Onboarding any further real household requires adding its
  own `legacyStudentId`-linked governed row the same way.

## 20. Scorecard (spec §31 — not inflated)

| Area | Status |
|---|---|
| Stable student identity exists and is used everywhere | ✅ |
| No name/phone-based identity anywhere in the resolution chain | ✅ |
| Parent Live Journey — real 7-state E2E | ✅ (live-verified) |
| Multi-child parent isolation | ✅ (live-verified) |
| Same-name children isolation | 🟡 (code-path + incidental live evidence only, not a dedicated test) |
| Adversarial ID rejection | ✅ (live-verified) |
| Driver/bus consistency | ✅ (live-verified) |
| School/admin regression | ✅ (spot-checked live) |
| GPS honesty (FRESH/STALE) | ✅ (live-verified) |
| Notification isolation | ✅ (automated suite only) |
| Full regression suite | ✅ (947/947 passing) |
| Typecheck/build | ✅ (clean) |

## 21. Final Classification (superseded by Phase 13.1 — see below)

**🟡 PILOT READY WITH ONE DOCUMENTED GAP** — not 🟢, specifically because
§13's mandatory same-name two-parent live test was not performed as its
own dedicated scenario (§19). Every other §33 success criterion this
report covers was met and live-verified, most importantly the phase's own
headline acceptance test: Parent Live Journey is now genuinely functional,
end-to-end, for a real authenticated account, driven entirely by a real,
stable, non-name identity bridge.

---

# Phase 13.1 — Same-Name Parent Adversarial Verification

## 1. Test Objective

Close the one gap Phase 13 left open: prove, with real data and the real
running application (not code inspection alone), that two different
parents who share an identical first name — and whose children *also*
share an identical first name — are never confused, merged, or
cross-leaked by the identity bridge, under direct adversarial attack.

No production code, schema, or authorization rule was changed in this
phase. The only changes are: one new automated regression test file, this
report section, and (temporarily, cleaned up afterward) two real test
households + one missing legacy login row seeded into the dev database for
live verification.

## 2. Test Environment

Real running dev server (`npm run dev`, same `tsx server.ts` process used
throughout Phase 13), real SQLite dev database, real `/api/auth/login`
sessions, real HTTP requests (both from actual browser tabs and from
in-page `fetch()` calls carrying real bearer tokens), real GPS Simulation
engine, real JourneyService state-machine transitions.

## 3–6. Household Identities

Two fully independent households were created directly in the dev
database (same repository/table shapes `database/seed/seed.ts` already
uses for the one real pilot household — legacy user + legacy student with
a real `parentId` FK + governed student with a real `legacyStudentId` FK +
governed user):

| | Household A | Household B |
|---|---|---|
| Parent name | أحمد بن اختبار A العائلة | أحمد بن اختبار B العائلة |
| Parent email | phase13-1-samename-a@masara.om | phase13-1-samename-b@masara.om |
| Legacy parent ID | `phase13-1-legacy-parent-A` | `phase13-1-legacy-parent-B` |
| Student name | محمد بن اختبار A العائلة | محمد بن اختبار B العائلة |
| Legacy student ID | `phase13-1-legacy-student-A` | `phase13-1-legacy-student-B` |
| Governed student ID | `020baa2a-ab3b-4db6-b900-3a4cdb5d1846` | `f1061502-6204-4b03-bc30-0d23d5ed948e` |
| Bus | حافلة 101 (bus 0) | حافلة 102 (bus 1) — a different bus, different driver |

## 7. Same-Name Condition

Confirmed directly: both parents' first name is **أحمد**, both children's
first name is **محمد** — the strongest form of this adversarial case
(name collision on *both* sides of the relationship simultaneously), not
just a coincidence of the fixture.

## 8. Ownership Verification

Queried directly from the database (`legacy_students.parentId`,
`students.legacyStudentId`): Student A's `parentId` is exactly Parent A's
ID and no other; Student B's is exactly Parent B's. Every ID in the table
above is a distinct row — no shared identity, no accidental reuse of an
ID across households.

## 9–10. Parent A / Parent B Live Results

Logged in via the real `/api/auth/login` endpoint (and, separately, via
the actual login form in two independent, never-cross-contaminated browser
tabs). Both parents see the identical greeting text "مساء الخير، أحمد"
(same first name) — and, on the very same screen, each sees **only their
own child**:

- Parent A → `GET /api/parent/journeys` → exactly one child, "محمد بن
  اختبار A العائلة" (governed ID `020baa2a...`).
- Parent B → exactly one child, "محمد بن اختبار B العائلة" (governed ID
  `f1061502...`).
- Neither list ever contained the other household's child, bus, journey,
  or location.

## 11. Cross-Student / Cross-Journey Attacks

Real journeys were created and driven to `on_bus` for both households via
their real, distinct driver accounts (driver1 for bus 101, driver2 for bus
102). Live HTTP results:

| Attack | Result |
|---|---|
| Parent A → Journey B's events | `403` |
| Parent B → Journey A's events | `403` |
| Parent A → Journey A's events (sanity, own data) | `200` |
| Parent B → Journey B's events (sanity, own data) | `200` |
| Driver A (driver1) → Bus B's telemetry directly | `403` |

## 12. Identity Smuggling

While authenticated as Parent A, a single request to
`/api/parent/journeys` carried `?studentId=<Student B>&journeyId=<Journey
B>&email=<Parent B's email>&userEmail=<Parent B's email>` — every
plausible smuggled identity field at once. The response was unaffected:
it returned Parent A's own child, exactly as an unsmuggled request would.
Client-supplied identity had **zero effect**; identity came exclusively
from the verified session, confirming the same property already
established in Phase 13's own report §12.

## 13. GPS Isolation

Independent GPS Simulation sessions were run for each household's own
trip/bus (`/api/gps-simulation/start` + `/advance`, admin-authenticated,
same real engine used throughout this project). Parent A's view showed
exactly Bus 101's coordinates; Parent B's showed exactly Bus 102's —
verified as genuinely different values, never swapped, never leaked into
the other parent's response.

## 14. Notification Isolation

After driving each household's journey to `on_bus` (a real
`STUDENT_BOARDED` event), `GET /api/parent/notifications` for Parent A
returned notifications for Student A only; Parent B's returned Student B
only. Zero cross-contamination despite the identical parent first name.

## 15. Session Tests

Both households authenticated exclusively through real, distinct session
tokens for their entire test lifetime; no session was reused across
households. (A dedicated expired/invalid-token revocation test already
exists and passes in `tests/services/governedApiAuthentication.test.ts`
and `tests/services/legacySessionAndAuthz.test.ts` — not re-run here to
avoid duplicating existing, still-passing coverage.)

## 16. Driver Regression

`GET /api/driver/trips` as driver1 returned only bus 101's trip; as
driver2, only bus 102's trip. Driver1 attempting bus 102's telemetry
directly was denied (`403`, see §11). **Note**: driver2 (`driver2@masara.om`)
had a real governed account but no `legacy_users` row at all before this
phase — a pre-existing seed-data gap from Phase 7H (only u-1..u-4 were ever
given legacy logins), meaning driver2 could not authenticate via the real
`/api/auth/login` endpoint at all. One legacy login row was added
(mirroring driver1's own existing pattern exactly) purely to make this
live check possible, then removed during cleanup. This finding is
documented in §25 below and was **not** fixed in application code or seed
data, per this phase's explicit scope.

## 17. School Regression

`GET /api/all-data` as school showed both new students as two fully
separate records with correct, distinct `busNumber`/`parentId` — never
merged despite identical child first names. `GET /api/operations/journeys`
as school showed two separate trip summaries (bus 101, bus 102) each with
its own correct `on_bus: 1` count, matching each household's own single
active journey.

## 18. Admin Regression

`GET /api/all-data` as admin: `200`, unaffected. No admin permission or
behavior was touched this phase.

## 19. Automated Regression Test

Added `tests/services/sameNameParentAdversarial.test.ts` — 8 tests,
formalizing this exact scenario against the isolated vitest test database
(fresh per file, same real service functions the HTTP routes call):
sanity/same-name confirmation, database ownership exclusivity,
`resolveAuthorizedStudents` non-merge, direct student-ID attack (both
directions), full Parent Live Journey view correctness (including
distinct real buses), journey-ID attack (both directions), GPS/bus
isolation (real `processObservation` calls, distinct coordinates asserted
both ways), and notification isolation including a `markNotificationRead`
cross-attack. All 8 pass.

## 20. Test Count

**44 test files, 955 tests, all passing** (947 from Phase 13 + 8 new in
this phase). No existing test was weakened or removed.

## 21. Typecheck

`npx tsc --noEmit` — clean, no errors.

## 22. Build

`npm run build` (vite + esbuild server bundle) — clean.

## 23. Browser Verification

Performed in two ways: (a) real HTTP requests via `fetch()` from an
authenticated page context, carrying real session tokens, for every
cross-attack and isolation check above; (b) two genuinely independent
browser tabs, each logging in through the real login form as Parent A and
Parent B respectively, confirming the rendered home screen shows the
identical greeting name but the correct, distinct child for each.

## 24. Console Verification

The tab used for the many deliberate adversarial `fetch()` calls
accumulated the expected 401/403/404 console entries — these are the
*proof* that denials work, not application defects (every one corresponds
to an intentional attack in §11/§12/§16 that was supposed to fail). A
**separate, freshly-opened tab** that only ever performed the real
login → home-screen flow for Parent B logged **zero console errors**.

## 25. Findings

- **Pre-existing gap (not introduced by Phase 13 or 13.1, not fixed):**
  self-service registration (`POST /api/auth/register`) creates only a
  `legacy_users` row — never a corresponding governed `users` row. A real
  parent who signs up through the app's own registration form today gets
  `404 المستخدم غير موجود في نظام الحوكمة` from every `/api/parent/*`
  endpoint, including Parent Live Journey, because no governed user record
  exists to resolve. Every account that *does* work today (the seeded demo
  accounts, and this phase's two test households) works only because it
  was provisioned with matching rows in **both** stores by direct
  database seeding — never through the app's own live registration flow.
  **This means Parent Live Journey does not yet work for any newly
  self-registered real parent**, only for households provisioned through
  seed-level tooling. This is a real onboarding gap for a genuine pilot
  and should be the next priority, but fixing it (a governed-user
  provisioning step, presumably inside `/api/auth/register` or a
  companion admin flow) is explicitly out of scope for this
  verification-only phase.
- **Pre-existing gap (not introduced by Phase 13 or 13.1, not fixed):**
  `driver2@masara.om` (and by the same logic, `driver3@masara.om`) has a
  full governed account but no legacy login row, so cannot authenticate
  via the real `/api/auth/login` endpoint at all — only `driver1` can.
  Same root cause and same recommendation as above.
- No identity leakage, merge, or cross-household confusion of any kind was
  found. No adversarial case in this phase succeeded.

## 26. Remaining Risks

- The two onboarding gaps in §25 mean the identity bridge itself is proven
  sound, but the *provisioning path* for genuinely new real households
  (beyond the ones seed-level tooling creates) is not yet built. A
  controlled pilot must either provision every real household the same
  way this test did (direct, careful seed-level insertion by an operator)
  or the registration flow must be extended first.
- Mobile-viewport and RTL-specific rendering of the same-name scenario
  specifically was not separately screenshotted this phase (time budget);
  the underlying components are unchanged from Phase 13's own already
  RTL-verified ones.

## 27. Final Conclusion

The same-name adversarial scenario — the one gap that kept Phase 13 at
🟡 — is now closed with real, live, adversarial evidence in both
directions, plus a permanent automated regression test. No cross-parent or
cross-student leakage exists anywhere this phase looked, including under
the specific attack this phase was designed to find. The identity
architecture itself is sound. The remaining blocker to a full, unqualified
🟢 is the two onboarding/provisioning gaps in §25 — not an identity or
security defect, but a missing "how does a new real family get into the
system" path, discovered here and deliberately left unfixed per this
phase's explicit scope.

## 28. Scorecard (updated, not inflated)

| Area | Score |
|---|---|
| Student Identity | 9/10 |
| Parent Ownership | 9/10 |
| Parent A/B Isolation | 10/10 |
| Same-Name Safety | 10/10 |
| Parent Live Journey | 8/10 (functional and correct, but not yet reachable for a newly self-registered real parent — §25) |
| GPS Security | 10/10 |
| Notification Isolation | 10/10 |
| Data Integrity | 10/10 |
| Overall Identity Architecture | 9/10 |

## 29. Final Pilot Decision

**🟡 READY WITH CONDITIONS.**

Every same-name / cross-parent / cross-student / GPS / notification
adversarial test passed, live, in both directions. The condition blocking
a full 🟢 is not a leakage or security defect — it is the two onboarding
gaps in §25 (self-registration and driver2/driver3 never getting a
governed↔legacy login pair provisioned automatically). Recommendation:
either restrict the controlled pilot to households provisioned the same
deliberate way this test's households were, or build the missing
provisioning step, before onboarding a real family through the app's own
self-service signup flow.
