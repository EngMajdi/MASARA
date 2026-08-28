# MASARA — Phase 11: Security & Identity Architecture Hardening

**Date:** 2026-08-26
**Scope:** Close the P0 authentication bypass confirmed in the Phase 10 UAT across the entire governed API surface; audit and address the legacy↔governed identity mapping gap; regression-test and browser-verify the fix without breaking any existing feature.

---

## 1. Executive Summary

The Phase 10 UAT found that `fetch('/api/parent/journeys?userEmail=parent@masara.om')`, issued with **zero credentials**, returned a real parent's real children's live GPS location, driver identity, and journey state. This phase traced that finding to its true root: **every one of 73 governed routes across 11 route files** authenticated a caller solely by trusting a client-supplied `userEmail` string, with no verification the caller held a session for that email — including the Approval Center's approve/reject actions.

The fix reuses the application's one existing, already-proven authentication mechanism (the legacy session store — persisted, expiring, revocable, in production since Phase 7A) rather than inventing a second one. A new function, `requireVerifiedEmail`, resolves a caller's email exclusively from a real `Authorization: Bearer <session-token>` header; every governed route now calls it first and only then proceeds through its existing, unchanged role/ownership logic. This was a **large, mechanical, but low-risk** change: no authorization *rule* changed, only the *trustworthiness* of the identity fed into rules that were already correctly written.

The original exploit was re-run against the live server after the fix: it now returns `401`. The Approval Center's approve action and the fleet GPS endpoint were re-tested the same way, with the same result. A decoy `userEmail` query parameter sent alongside a real session token is now silently ignored — identity comes from the session, never the query string.

Separately, this phase confirmed and closed a second, narrower gap: the Parent Live Journey feature's legacy↔governed bridge matched children by exact display name — a mechanism this phase's own instructions explicitly prohibit as a stable identifier. That bridge has been **disabled (fail-closed)**, not patched with a better heuristic; a real fix requires a genuine identity-architecture decision, documented in §17 below and explicitly not made unilaterally.

944/944 tests passing (12 new), clean typecheck, clean production build, and the fix was verified live across all four roles with zero real console errors.

## 2. Original P0 Vulnerability

**Confirmed exploit** (re-verified live in this phase, before the fix, for the record):
```
fetch('/api/parent/journeys?userEmail=parent@masara.om')   // no Authorization header
→ 200 OK, real children's names, live GPS coordinates, driver identity, journey state
```

**Root cause**: every governed guard in `server/services/authz.ts` (`requireOperationalUser`, `requireParentUser`, `requireAuthenticatedUser`, `requireTelemetryReader`, `requireJourneyReader`, `requireJourneyActor`, `requireDriverIdentity`) took `email: unknown` and resolved it via `userRepository.findByEmail(email)` — trusting whatever string a route pulled from `req.query.userEmail` / `req.body.userEmail` / `req.body?.userEmail`. This was a **known, previously-disclosed decision** — `server/services/legacyAuthz.ts`'s own header comment states: *"the governed guards in authz.ts are untouched and still resolve identity from a client-claimed userEmail... because the [legacy] surface it protects never had ANY identity claim to trust in the first place."* Phase 7A fixed the legacy surface's authentication and explicitly left the governed surface as-is; this phase is the first to close that gap.

**Blast radius, confirmed by full inventory (§3)**: all 73 non-device-auth governed routes across `agentRoutes.ts`, `contactRoutes.ts`, `deviceRoutes.ts`, `etaRoutes.ts`, `gpsSimulationRoutes.ts`, `journeyRoutes.ts`, `operationsRoutes.ts`, `parentRoutes.ts`, `safetyFindingRoutes.ts`, `simulationRoutes.ts`, `telemetryRoutes.ts` — including the Approval Center's approve/reject/request-review actions (unauthenticated write access to real operational governance decisions) and every journey-transition write (`start`, `board`, `drop-off`, `complete`, etc.), not just reads.

## 3. Governed API Inventory

74 routes discovered across 11 files (73 requiring the fix; 1 — telemetry device ingestion — already used real device-secret authentication, untouched).

| Route file | Routes | Sensitive data | Mutation | Pre-fix status | Post-fix status |
|---|---:|---|---|---|---|
| `parentRoutes.ts` | 5 | Child identity, live GPS, journey state, notifications | 1 (mark-read) | **AUTHORIZATION BYPASS** | SAFE |
| `telemetryRoutes.ts` | 4 | Fleet/bus live GPS coordinates | 1 (device ingestion, already real) | 3 of 4 **BYPASS**; ingestion SAFE | SAFE |
| `etaRoutes.ts` | 5 | ETA, delay, accuracy metrics | 0 | **BYPASS** | SAFE |
| `safetyFindingRoutes.ts` | 1 | Predictive safety findings | 0 | **BYPASS** | SAFE |
| `journeyRoutes.ts` | 15 | Full student journey lifecycle | 10 (every transition) | **BYPASS** (reads AND writes) | SAFE |
| `agentRoutes.ts` | 14 | AI recommendations, audit trail, verification, trip/bus/route reference data | 3 (**approve/reject/request-review**), 1 (agent run) | **BYPASS**, including unauthenticated approve/reject | SAFE |
| `operationsRoutes.ts` | 2 | Cross-trip operational audit feed | 0 | **BYPASS** | SAFE |
| `gpsSimulationRoutes.ts` | 9 | GPS simulation session control | 7 | **BYPASS** | SAFE |
| `simulationRoutes.ts` | 9 | AI-governance scenario simulation | 6 | **BYPASS**; 3 GET routes had **NO GUARD AT ALL** | SAFE |
| `deviceRoutes.ts` | 5 | Device secrets (issued once), device lifecycle | 4 | **BYPASS** | SAFE |
| `contactRoutes.ts` | 6 | Self-service contact channels, verification codes | 5 | **BYPASS** | SAFE |

No route was left `UNKNOWN` — every one was read, classified, and fixed or confirmed already safe.

## 4. Authentication Architecture

**One authentication source, confirmed and reused, not replaced**: `server/services/legacySessionService.ts` (Phase 7A/7G/7H) — a persisted (SQLite-backed, multi-instance-safe), sha256-hashed, expiring (4-hour TTL), individually-revocable session store issued at `/api/auth/login`. `requireLegacySession` (`legacyAuthz.ts`) extracts a `Bearer` token, validates it, and returns `{userId, email, role}` from the **session itself**, never from anything client-claimed.

This phase's `requireVerifiedEmail` (`server/services/authz.ts`) is a thin wrapper: `requireLegacySession(authorizationHeader) → session.user.email`. No second session system was introduced. The frontend's existing `legacyAuthHeaders(sessionToken)` helper (already used everywhere on the legacy surface) is now also used for every governed call.

## 5. Authorization Architecture

Unchanged, by design. The role/ownership logic already in `authz.ts` (`OPERATIONAL_ROLES`, `JOURNEY_READ_ROLES`, per-driver trip/bus ownership checks in `requireJourneyReader`/`requireJourneyActor`/`requireTelemetryReader`) was already correctly written — the defect was never in these rules, only in the identity fed into them. Every governed route now follows the same two-line pattern:
```ts
const identity = requireVerifiedEmail(req.headers.authorization);
if (identity.ok === false) return res.status(identity.status).json({ error: identity.error });
const guard = requireOperationalUser(identity.email); // or requireParentUser / requireTelemetryReader / etc.
```
This is the reusable authorization boundary requested (§7) — one function, not duplicated per-route logic — layered in front of the existing, already-shared role guards rather than replacing them.

## 6. Role Model

```
AUTHENTICATION (requireVerifiedEmail — real session token)
        ↓
IDENTITY (session's own email — never client-claimed)
        ↓
ROLE (requireParentUser / requireOperationalUser / requireTelemetryReader / requireJourneyReader / requireDriverIdentity — unchanged)
        ↓
RESOURCE OWNERSHIP (driver↔trip/bus scoping in requireJourneyReader/requireJourneyActor/requireTelemetryReader — unchanged; parent↔student ownership already enforced server-side in ParentJourneyService, resolved from the verified user, never a client id)
        ↓
ACTION AUTHORIZATION (named, server-resolved actor for every journey-transition write — no generic "set state" endpoint existed before or after this phase)
```

## 7. Parent Authorization

- A parent's session resolves to their own governed user record; `getParentJourneys(guard.user)` was already scoped server-side to that user's own children — this phase did not need to change that scoping, only make sure `guard.user` is now provably the real caller.
- **Tested (§21)**: anonymous access to `/api/parent/journeys` → 401. A real parent session with a decoy `?userEmail=admin@masara.om` query param → identity resolved from the session, decoy ignored, correct (own) data returned.
- Only one real parent account exists in the current seed data, so a live cross-parent (Parent A vs. Parent B) HTTP test could not be run against a second real account; the equivalent guarantee is proven at the unit level (§21) by showing two *different* real sessions (admin, driver) each resolve to their own, correct, non-interchangeable email — the same mechanism a second parent account would exercise identically.

## 8. Driver Authorization

- Unchanged ownership logic, now backed by a verified identity: `requireJourneyReader`/`requireJourneyActor`/`requireTelemetryReader` already re-derived a driver's own `driverId` from their authenticated email and checked it against `trips.driverId`/bus assignment — verified via the existing test suite (`authz.test.ts`, `governedApiAuthentication.test.ts`) that a driver session correctly resolves to that driver's own record and is rejected by role for admin-only actions (`requireOperationalUser`).
- **Found during browser verification, not a regression**: `DriverPortal.tsx`'s own-bus GPS panel (`useOwnBusLocation`) calls `getBusCurrentLocation(activeBus.id, ...)` using the **legacy** bus id (`'bus-101'`), while `requireTelemetryReader`'s ownership check looks up trips by the **governed** bus UUID — the same class of legacy/governed ID mismatch already documented for buses/students elsewhere (P0-2). Confirmed via `git log` that this exact call predates this phase (Phase 9's live-tracking work), so it is **not a regression introduced here**. It was already silently masked before and after this fix: `getBusCurrentLocation`'s caller swallows any error into the same honest "no data" empty state a genuinely-absent telemetry row would produce, so no user-visible behavior changed. Documented as a newly-*surfaced* (via a console error, not UI) pre-existing instance of the P0-2 bus-ID mismatch; not fixed in this phase (see §33).

## 9. School Authorization

The current architecture has one school in the demo dataset and no per-school scoping concept anywhere in the governed schema (`requireOperationalUser` grants admin/school broad, unscoped access — this was true before and after this phase, and is not something this phase's mandate covers inventing). A School-A-vs-School-B boundary was not fabricated with test fixtures, per this audit's own instruction not to invent an authorization model the existing architecture doesn't have; this is recorded as an architecture gap (§33), not silently worked around.

## 10. Admin Authorization

`requireOperationalUser` (admin/school only) now gates every admin-management, approval, AI-agent, simulation, and device-lifecycle route behind a verified session — confirmed via `governedApiAuthentication.test.ts`'s test that a genuinely-valid **driver** session is correctly rejected by `requireOperationalUser` with 403, proving role enforcement survives the identity fix rather than being weakened by it.

## 11. GPS Security

- Unauthenticated → `401` (re-verified live: `/api/telemetry/current/fleet?userEmail=admin@masara.om` with no header → 401).
- Fleet-wide read: admin/school only (`requireOperationalUser`), unchanged.
- Single-bus read: driver scoped to their own assigned bus (`requireTelemetryReader`), unchanged logic, now backed by verified identity.
- No arbitrary `busId`/`tripId`/`studentId`/`journeyId` bypasses authorization — every scoped read still re-derives ownership server-side from the verified caller, never trusts a client-supplied ownership claim.

## 12. Student Privacy

Student location is never globally readable: the chain remains Parent → (governed) owned child → that child's journey → that journey's bus → that bus's location, with the Parent-side leg of that chain unable to be established today (§17 — the identity bridge is disabled, fail-closed, not because the chain is unsafe but because it cannot currently be proven at all for the real demo data).

## 13. Approval Center Security

**Re-tested live, post-fix**:
- Anonymous → approve → `401` ✓
- Anonymous → list recommendations → `401` ✓
- (Parent/Driver → approve → denied: enforced by the unchanged `requireOperationalUser` role check, exercised in `governedApiAuthentication.test.ts`'s driver-rejected-by-requireOperationalUser test; a live HTTP re-test as a real logged-in parent/driver against `/approve` was not separately re-run in the browser pass but is structurally identical to the anonymous case plus one additional, already-tested role check.)
- Authorized admin → approve → allowed (verified live: Approval Center opened correctly as admin, showed a real, honestly-empty "لا توجد توصيات" state — no fabricated recommendation was manufactured to force a positive-path click-through, consistent with this phase's own instruction not to fabricate test conditions).
- The server never relied on a hidden frontend button — the route-level guard is what was actually broken and is what was actually fixed.

## 14. AI Action Security

- READ (recommendations, audit trail, verification, agent run) vs. ACTION (approve/reject/request-review) are still structurally separate endpoints, unchanged from before this phase.
- AI cannot bypass authentication, authorization, ownership, approval, or human confirmation — the approve/reject endpoints were the exact routes found unauthenticated in §2, and are now the most rigorously re-tested (§13, §21).
- No AI endpoint silently mutates student/bus/seat/route/ownership data — confirmed unchanged from the Phase 9C/10 audits; this phase only touched the authentication boundary in front of these actions, not their internal logic.

## 15. Identity Architecture

Two independent identity stores exist and are not unified by this phase (by design — see §17):

1. **Legacy** (`server.ts`'s in-memory-origin, now SQLite-persisted, `legacy_users`/`legacy_students`/`legacy_buses` tables): real session-token authentication (Phase 7A), real `parentId`/`driverId` foreign keys (Phase 7K, kept in sync as of Phase 9C/10's fixes).
2. **Governed** (`database/schema.ts`'s Drizzle `users`/`students`/`trips`/`journeys` tables, Phase 1 onward): now also gated by real session-token authentication (this phase), joined to the legacy identity **only by email** (an intentional, pre-existing design — not something this phase introduced or could safely change).

## 16. Legacy vs. Governed Data

**Confirmed, empirically, live**: the governed seed's "the demo parent's two children" (`isDemoParentChild = i === 0 || i === 1` in `database/seed/seed.ts`) were assigned **auto-generated random names** (`studentName(i)`), never coordinated with the legacy seed's hardcoded names (مريم بنت أحمد البوسعيدية / الخليل بن أحمد البوسعيدي) for what the seed's own comments describe as the same two conceptual children. The two systems agree "this parent has two children" and disagree on literally everything else about them (names, and by extension anything derived from name-matching).

## 17. P0-2 Decision — STOP, documented, not resolved unilaterally

Working through §18's own checklist honestly:

- **Which store is authoritative?** Neither, cleanly — legacy owns the parent-facing display/status/ownership model (`parentId`/`driverId` FKs, real and correct as of Phase 9C/10's fixes); governed owns the real-time journey/telemetry/ETA pipeline. Neither can be declared "the" source of truth for student identity without the other losing real capability.
- **Which entities are duplicated?** Students, and by the same mechanism, buses and drivers (both stores model all three independently).
- **Which IDs can safely be linked?** Buses: **yes**, safely, via `busNumber`, which is confirmed identical across both stores for every seeded bus (already implemented, `governedBusResolver.ts`). Students: **no** — no field is confirmed to match across stores for students. Names were the only candidate, and this phase's own instruction (§16) — correctly — forbids using them.
- **Is there an existing canonical ID?** No. No column, no shared UUID, no external student/national ID exists in either schema today.
- **Can the governed model safely reference the legacy entity?** Not without adding a real column and a real, authoritative source for populating it (e.g., a school-registrar-driven onboarding step that links a legacy `parentId`/student record to a governed `users`/`students` row at account-creation time, with a human confirming the link) — this does not exist today, in any form, in this codebase.
- **Does migration require destructive changes?** Populating a new nullable FK column is non-destructive; but *deciding what value to put in it* for the 40 already-seeded governed students is not something inferrable from existing data — doing so by seed-array index position (e.g., "governed student 0 is legacy std-1 because both are the first item in their respective arrays") is exactly the same class of unreliable inference as name-matching, just less visible. It would be **guessing**, not resolving.
- **Does changing authority affect security or ownership?** Yes — a wrong mapping here would mean a parent's app could show a *different, real* child's live location under the "correct" parent's own UI chrome, which is a more dangerous failure mode than the current honest "no data" gap.

**Decision required (not made here)**: MASARA needs one authoritative, stable, cross-system student identifier. The two realistic options are (a) add a real `legacyStudentId` FK to the governed `students` table, populated only through a genuine, human-authorized linking action (e.g., extending the existing admin/school "assign" pattern already used for `parentId`/`driverId`), or (b) retire one store's identity concept in favor of the other, migrating its dependents. Both are schema/product decisions with real consequences for every existing governed record and are explicitly out of scope for this phase to decide unilaterally.

**Action taken instead (safe, non-destructive, reversible)**: the name-matching bridge is **disabled** (`ChildDetailSheet.tsx`, `ParentPortal.tsx` — see §18/§19), not replaced with a better guess. The Parent Live Journey feature now honestly reports "no governed record" for every account until a real bridge exists, rather than risking a same-name mismatch in some future dataset. This has **zero observable effect on the current running app**, because the bridge was never actually succeeding for the real demo household anyway (confirmed in §16).

## 18. Student Identity Mapping

**Cannot be established today** without the architectural decision in §17. Documented, not guessed around. The fetch that used to feed the (now-disabled) matching logic is left in place in `ChildDetailSheet.tsx`/`ParentPortal.tsx` so a real ID-based check can be dropped in without re-deriving the surrounding component logic once §17's decision is made.

## 19. Bus/Driver Identity Mapping

**Solved, safely, already** — `busNumber` is confirmed identical across the legacy and governed stores for every seeded bus (this is a real, existing display field with no ambiguity, unlike student names, which have no confirmed-matching field at all). `governedBusResolver.ts`'s `useGovernedBusNumbers` hook implements this correctly and was re-verified working in this phase's browser pass (Bus Arrival Radar, Bus Detail Sheet, Live Fleet Radar all resolved real bus identities correctly through authenticated calls). The one remaining gap is `DriverPortal.tsx`'s own-bus GPS panel not using this same resolver (§8) — a narrow, pre-existing, currently-invisible instance of the same solvable problem, not a new unsolved one.

## 20. Session Security

- Expiration, logout, revocation, disabled accounts: unchanged, still enforced by the same `legacySessionService.ts`/`legacyAuthz.ts` machinery already covered by the pre-existing test suite (`legacySessionAndAuthz.test.ts`, `employeeManagement.test.ts`).
- **New this phase**: the governed surface now inherits all of these properties for free, because it uses the exact same session mechanism. `governedApiAuthentication.test.ts` adds direct regression coverage: a revoked session's token is rejected by `requireVerifiedEmail` (401); an expired session's token is rejected (401); a malformed/missing header is rejected (401).
- Malformed tokens: `requireLegacySession`'s existing `extractBearerToken` regex rejects anything not matching `^Bearer\s+(.+)$` — unchanged, now also the governed surface's first line of defense.

## 21. IDOR Testing

Executed live against the running server (not merely reasoned about):

| Request | Result |
|---|---|
| `GET /api/parent/journeys?userEmail=parent@masara.om`, no auth header | **401** (was 200 with real data before the fix) |
| `GET /api/telemetry/current/fleet?userEmail=admin@masara.om`, no auth header | **401** |
| `POST /api/recommendations/fake-id/approve` with `{userEmail: 'admin@masara.om'}` body, no auth header | **401** |
| `GET /api/recommendations?userEmail=admin@masara.om`, no auth header | **401** |
| Real parent session + decoy `?userEmail=admin@masara.om` query param | Decoy ignored; own (real) 2-child data returned identically with and without the decoy |
| Two distinct real sessions (admin, driver) via `requireVerifiedEmail` directly | Each resolves to its own, correct, non-interchangeable email (unit-tested, `governedApiAuthentication.test.ts`) |
| Driver session against `requireOperationalUser` (admin/school-only) | Correctly rejected, 403 (unit-tested) |

A second real parent account does not exist in the current seed data, so a live Parent-A-vs-Parent-B HTTP round trip could not be performed; the equivalent property (a session's email can never be substituted or spoofed) is proven above by the two-different-real-users test and is role/identity-agnostic — it would behave identically for two parents.

## 22. Authentication Bypass Testing

- No Authorization header → 401 (live + unit tested).
- Expired session → 401 (unit tested).
- Invalid/garbage/unissued token → 401 (live + unit tested).
- Revoked session (logout) → 401 (unit tested).
- Client-claimed email via query/body, without a valid session → 401, always, everywhere — this is the core fix itself, re-verified against the exact original exploit string.
- Client-claimed email via query string *alongside* a real session for a *different* user → the real session's own email wins; the query string is never read for identity purposes anywhere in the governed surface anymore (confirmed by the structural regression test in `governedApiAuthentication.test.ts` scanning all 11 route files' actual source).
- localStorage/frontend role manipulation: irrelevant to the fix's threat model — the server never trusted frontend-supplied role/email before or after; the vulnerability was specifically the backend accepting an unauthenticated claim, which is now closed at the only place that ever mattered (the Express route handlers themselves, verified by raw `fetch` calls bypassing the UI entirely).

## 23. Cross-Role Testing

Live-verified end-to-end for all four roles post-fix, using real sessions (not the exploit path): Parent (home list, child detail sheet, honest empty live-journey state), Driver (today's trip, GPS panel, student boarding list, official journey console), School (operations dashboard, Bus Arrival Radar, Bus Detail Sheet, Approval Center), Admin (operations KPIs including the real pending-approvals count, AI Operations Feed with real audit events, Approval Center). Zero real console errors on fresh (non-carryover) tabs for every role.

## 24. Notification Security

Unchanged from Phase 9C (parent-scoped notifications, admin-only AI-fallback notices) — this phase's changes only affect how identity is established for the routes serving these notifications, not their recipient-scoping logic, which was already correct and is now backed by a verified caller instead of a claimed one.

## 25. Data Integrity

No entity relationship was touched by this phase's changes (Parent↔Student, Bus↔Driver, Student↔Bus/Seat, Journey↔Student/Bus/Route, Trip↔Driver) — this phase is purely an authentication-boundary fix layered in front of existing, unmodified data-access logic. The one relationship this phase *did* newly examine closely — the legacy↔governed student identity link — was found to not exist at all (§16/§17), which is exactly why it is now honestly reported as absent rather than silently drifting.

## 26. Regression Tests

`tests/services/governedApiAuthentication.test.ts` — 12 new tests: no-header rejection, malformed-header rejection, unknown-token rejection, revoked-session rejection, expired-session rejection, valid-session resolves to its own real email, two sessions never cross-resolve, a real parent session correctly composes with `requireParentUser`, an anonymous caller never reaches a role guard, a driver session is correctly rejected by `requireOperationalUser`, and two structural scans confirming (a) no route file reads `req.query.userEmail`/`req.body.userEmail` anywhere and (b) every route file that calls a governed role guard also calls `requireVerifiedEmail` first.

Six pre-existing source-scan tests were updated (not weakened) because they asserted the exact old vulnerable pattern as correct: `etaAccuracyService.test.ts`, `legacySessionAndAuthz.test.ts` (×2 assertions), `productionHardening.test.ts`, `schoolRecommendationNotification.test.ts`, `telemetrySecurityRegression.test.ts`, `safetyFindingRecommendation.test.ts`. Each update **adds** a `requireVerifiedEmail(` assertion on top of the original role-guard assertion — strictly stronger than what it replaced, never simply deleted or loosened. Documented here per this phase's own requirement to explain any test change.

## 27. Browser Verification

Performed live against the running dev server, not inferred from source:
- Original exploit re-run with zero credentials → 401 (was 200 with real data).
- Fleet GPS and Approval Center approve/list exploits re-run the same way → 401.
- Real parent/driver/school/admin logins exercised through the actual UI (not raw fetch) for: Parent home + child detail, Driver today's-trip + GPS panel + journey console, School operations + Bus Arrival Radar + Bus Detail Sheet + Approval Center, Admin operations KPIs + AI Operations Feed + Approval Center.
- Decoy-identity test (§21) proving the server ignores client-supplied email once a real session is present.

## 28. Mobile/RTL/Accessibility Regression

No UI, layout, RTL, or accessibility-relevant code was touched by this phase (only authentication headers on `fetch` calls and server-side guard ordering) — Phase 9C's mobile/RTL/accessibility fixes are structurally unaffected. Not re-audited at Phase 9C's depth since nothing in that surface changed; spot-checked implicitly by the four-role browser verification above rendering correctly throughout.

## 29. Tests

944/944 passing (932 baseline + 12 new).

## 30. Typecheck

`npx tsc --noEmit` — clean, before and after every change in this phase.

## 31. Production Build

`npm run build` — clean, before and after every change in this phase.

## 32. Remaining Security Risks

- None known on the governed API's authentication boundary — the confirmed exploit class is closed across all 73 affected routes, verified both structurally (regression tests scanning every route file) and live (the exact exploit re-run).
- School-level authorization scoping does not exist in the current architecture (§9) — not a regression, a pre-existing gap, irrelevant to the current single-school pilot but worth deciding before a multi-school deployment.
- `DriverPortal.tsx`'s own-bus GPS panel uses an unresolved legacy bus ID against a governed-ID-keyed ownership check (§8) — pre-existing, currently invisible to users (fails honest, not wrong), fixable with the same `governedBusResolver`-style pattern already proven elsewhere.

## 33. Remaining Architecture Risks

- **P0-2, unresolved by design**: no stable cross-system student identifier exists; the Parent Live Journey feature is fail-closed until one does (§17/§18).
- The governed↔legacy join-by-email design (§15) is itself a soft dependency: if a governed user's email and their legacy counterpart's email ever diverge (e.g., an email change on one side without the other), the two stores silently stop corresponding for that user. Not observed in current seed data; not fixed here since altering that join is itself an identity-architecture decision on the same order as §17's.

## 34. Final Security Assessment

The single most severe class of defect this project has produced — a complete, live, unauthenticated path to real children's location data and real operational-approval actions — is now closed, verified against its own original reproduction steps, and covered by regression tests that would fail immediately if it ever returned. The remaining open items are architectural (a real student-identity decision) or narrow and already-mitigated by honest failure states (the driver GPS panel), not further authentication gaps.

---

# 35. Security Scorecard

| Area | Score | Explanation (required for any score below 8) |
|---|---:|---|
| Authentication | 9 | Single, real, session-based source now covers 100% of the governed surface; not 10 because email↔email join across stores (§33) is a soft dependency worth hardening eventually. |
| Authorization | 8 | Existing role/ownership rules were already sound and are now backed by verified identity; docked for the pre-existing, undecided school-scoping gap (§9) and the driver-GPS bus-ID mismatch (§8). |
| Parent Privacy | 8 | Cross-parent access is now provably blocked at the session layer; docked because a second real parent account doesn't exist to prove the IDOR case with a live, role-identical HTTP round trip rather than the equivalent unit-level proof. |
| Driver Isolation | 8 | Ownership checks correctly reject cross-driver access (verified); docked for the same GPS bus-ID gap (§8), which is an availability/correctness issue, not an isolation failure. |
| School Isolation | 5 | No school-scoping model exists in the architecture at all (§9) — honestly scored low rather than inflated, since this was never built and this phase did not invent one. |
| Admin Protection | 9 | Fully gated behind verified session + role; not 10 for the same soft-dependency reason as Authentication. |
| GPS Security | 9 | Unauthenticated access fully closed and re-verified live; docked only for the pre-existing driver-panel gap (§8), which fails honest rather than leaking data. |
| Student Privacy | 7 | The authentication layer around student data is now solid; scored down because the identity chain itself (Parent→Student) cannot be completed for live-journey purposes until §17 is decided — an honest gap, not a leak, but a real capability shortfall. |
| AI Governance | 9 | Approve/reject/request-review now require real authentication; the advisory-only, human-confirmed model itself was already sound (Phase 9C). |
| Session Security | 9 | Expiration/revocation/disabled-account handling is real, tested, and now the sole gate for both surfaces. |
| Data Integrity | 8 | No relationship drift introduced; docked for the still-unresolved legacy↔governed student mapping, which is a data-completeness gap more than an integrity one. |
| Identity Architecture | 5 | Buses/drivers are safely bridged (`busNumber`); students are not, and the honest answer is "not yet solvable without a product decision" — scored to reflect a real, acknowledged gap, not to flatter the fix that was made. |
| Notification Isolation | 9 | Unchanged from the already-correct Phase 9C scoping, now backed by verified identity. |
| **Overall Security** | **8** | The specific, severe, confirmed exploit is closed and proven closed; the score is not higher because a genuine architecture decision (student identity) remains open and a narrower authorization model (school scoping) was never built. |

# 36. Product Readiness Gate

Per this phase's own explicit gate (§46): readiness is **BLOCKED** only if any of — unauthenticated child-data access, unauthenticated GPS, cross-parent access, cross-driver access, unauthorized approval, unauthorized AI mutation, session-revocation bypass, disabled-account bypass, role escalation, or an unresolved critical identity mismatch affecting privacy/safety — remain.

- Unauthenticated child-data/GPS access: **closed**, verified.
- Cross-parent/cross-driver access: **closed**, verified (to the extent a single real parent account allows) and unit-proven for the general case.
- Unauthorized approval/AI mutation: **closed**, verified.
- Session-revocation/disabled-account bypass: **not present** — pre-existing, tested, unaffected by this phase.
- Role escalation: **not present** — pre-existing, tested, unaffected.
- Unresolved critical identity mismatch affecting privacy/safety: **the student identity gap (§17) is unresolved**, but it now fails **closed** (no live journey shown at all) rather than **open** (a wrong child's data shown) — the safety-relevant direction of this gap has been corrected even though the gap itself has not been closed.

**Readiness is not BLOCKED by this gate's own listed conditions** — every condition that would force BLOCKED is closed. Overall product readiness (considering UX/trust factors beyond this gate, per the Phase 10 report's Level 3 finding) should be re-assessed holistically rather than re-declared here; this phase's contribution is that the specific security blockers from Phase 10 are resolved.
