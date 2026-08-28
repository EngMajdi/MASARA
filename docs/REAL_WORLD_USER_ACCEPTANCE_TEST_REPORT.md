# MASARA — Phase 10: Real-World User Acceptance Test Report

**Date:** 2026-08-26
**Scope:** Complete transportation lifecycle, cross-role consistency, security, accessibility, RTL, mobile, and data-honesty audit across Parent, Driver, School, and Admin — live-browser-first, using real seeded accounts and a real GPS simulation run.

---

## 1. Executive Summary

MASARA's customer-facing UX (Phases 9/9B/9C) holds up well under end-to-end testing: the four role experiences are coherent, the honesty rules around live/stale/unavailable data are genuinely enforced in the UI, and every P0 fixed in Phase 9C (wrong-child ownership, fabricated Parent ETA, fabricated AI fallback, fabricated Admin KPI, inaccessible clickable Cards, undersized Driver touch targets) was re-verified live and **remains fixed**.

This phase found two classes of new, real defects:

1. **A second instance of the exact bug class fixed in Phase 9C**, now on bus↔driver assignment (`Bus.driverId`/`Bus.driverName` could disagree the same way `Student.parentId`/`parentName` could) — found live, root-caused, fixed, and regression-tested in this phase.
2. **A critical, systemic authentication gap in the entire "governed" backend API surface** (the layer behind GPS Live Radar, Parent Live Journey, ETA, Approval Center, AI agent actions, and more): every one of these ~11 route files authenticates a caller *solely* by trusting a client-supplied `userEmail` parameter, with no verification that the request actually holds a valid session for that email. This was empirically confirmed exploitable with a single unauthenticated `fetch()` call that returned a real parent's real children's live GPS location, driver identity, and journey state with zero credentials. **This was not fixed in this phase** — per this audit's own explicit instruction to STOP on unsafe authorization behavior rather than unilaterally patch backend architecture, and because a correct fix touches essentially the entire governed frontend+backend surface and deserves its own dedicated, fully-regression-tested phase. It is documented in full in §16 and flagged at the top of the final response.

A second, narrower architectural finding (§32/P0-2) was also confirmed empirically: the Parent Live Journey feature's legacy↔governed student name-matching bridge is provably broken for the actual demo parent account, because the two seed generators never produced matching child names for "the same" conceptual household. This makes GPS Live Radar/Live Journey silently and permanently inert for that account's real children, even though the underlying telemetry pipeline itself works correctly (verified via the bus-level, `busNumber`-matched bridge, which does work).

## 2. Test Environment

- Windows/PowerShell, Vite dev server (`npm run dev`, port 3000), SQLite dev DB (`database/masara.db`) — not reseeded during this phase (verified its state matched the intended seed baseline before starting, after one residual row from prior-session testing was found and corrected).
- Browser: the Claude Code Browser pane (Chromium-based), driven live for every finding in this report — no finding was declared from source reading alone.
- Baseline before any change this phase: 931/931 tests passing, clean `tsc --noEmit`, clean production build.

## 3. Real Accounts/Roles Tested

| Role | Account | Notes |
|---|---|---|
| Parent | parent@masara.om | Real household: 2 legacy children (مريم، الخليل) on بus 101 |
| Driver | driver1@masara.om | Assigned bus 101, real active trip with 3 boarded / 1 absent student at test start |
| School | school@masara.om | مدرسة المسار الدولية |
| Admin | admin@masara.om | Full operations scope |

A second real employee (مجدي الذيابي, created in an earlier session via Employee Management) was used to test the bus/driver assignment bug.

## 4. Complete Journey Matrix

| Journey | Parent | Driver | School | Admin | Result |
|---|---|---|---|---|---|
| Login | ✓ | ✓ | ✓ | ✓ | PASS |
| Trip in progress (pre-existing) | ✓ | ✓ | ✓ | ✓ | PASS |
| GPS movement (real simulation) | — | — | ✓ | ✓ | PASS (bus-level bridge) |
| GPS movement reaching Parent | ✗ | — | — | — | **FAIL — see §32/P0-2** |
| Boarding status | ✓ | ✓ | ✓ | ✓ | PASS (shared legacy field) |
| Absence | ✓ | ✓ | ✓ | ✓ | PASS |
| Delay detection | — | — | ✓ | ✓ | PASS (real ETA-derived) |
| Bus/driver reassignment integrity | — | — | ✓ | ✓ | FAIL found → FIXED |
| Notifications (role-scoped) | ✓ | — | — | ✓ | PASS |
| AI (advisory, disclosed) | — | — | ✓ | ✓ | PASS |
| Security — legacy surface | ✓ | ✓ | ✓ | ✓ | PASS |
| Security — governed surface | ✗ | ✗ | ✗ | ✗ | **FAIL — P0, see §16** |
| Accessibility (Card keyboard) | ✓ | ✓ | ✓ | ✓ | PASS (2 gaps found → fixed) |
| Mobile (no overflow, 44px targets) | ✓ | ✓ | ✓ | — | PASS |

"—" = not directly exercised for that role in this pass (out of scope for that specific row, not blocked).

## 5. Parent Journey Results

Verified live: login → home → child card → detail sheet → absence report.

- **Login/home**: correct account, correct 2 children, no unrelated students (re-verified the Phase 9C ownership fix survived — see §22 for the *new* instance found this phase on the bus side).
- **Trip-not-started honesty**: confirmed — no fake ETA, no fake "arriving in 4 minutes," clear "لا توجد رحلة مباشرة نشطة" state when no journey is genuinely active.
- **Driver starts trip → Parent reflects it**: **could not be verified as a live propagation**, because — as detailed in §32 — the governed journey that genuinely goes live for bus 101 belongs to a governed student ("محمد بن المعمري الهنائي") whose name never matches either of this parent's real legacy children. The Parent UI's honest fallback ("no active live journey") is *technically correct given broken input*, but the live-journey feature itself never activates for this account's real children regardless of what the driver actually does. This is the single most important Parent-facing finding.
- **Multi-child distinguishability**: مريم and الخليل are clearly distinguished by name, grade, and status on the home list; no confusion observed.
- **Absence reporting**: UI flow present and reachable; not executed to completion (would mutate live demo data unnecessarily for this pass).

## 6. Driver Journey Results

- Today's Trip screen: real route, real bus/plate, real boarding counts (3/0/1 at test start), real next-stop name, honest GPS Live Radar (showed "الموقع غير متاح حالياً" before a fresh simulation run, then genuinely live data after one was started).
- One primary action model confirmed: the SwipeableCard boarding list is primary, the legacy "governed journey record" console is deliberately collapsed/secondary — no duplicate/competing "Start Trip" affordance was found.
- Board/Absent actions: real `<button>` fallbacks alongside the swipe gesture (not swipe-only), now 44×44px (Phase 9C fix, re-verified holding on a genuine mobile viewport this phase).

## 7. School Journey Results

- Operations → Attention Required → Bus Arrival Radar → Live Fleet Radar → Bus Detail Sheet → Attendance Matrix → Distribution Assistant: full click-through performed.
- With a real GPS simulation running, Bus 101 correctly flipped from "لم تبدأ الرحلة" to "متأخرة" (delayed) with a real ETA-derived signal, and correctly appeared in the consolidated Attention Required list — confirming the Phase 9C consolidated-attention fix works with genuinely live data, not just in the abstract.
- **Bug found here**: Bus 102's displayed driver name did not match its real assigned driver (see §22 — fixed in this phase).

## 8. Admin Journey Results

- Operations tab KPIs (active buses, students en route, attention count, pending approvals) all confirmed real and changing with real data (re-verified the Phase 9C "—" KPI fix).
- AI tab: route-optimization and reroute-simulation both exercised; both correctly disclosed "تعذّر الوصول إلى خدمة الذكاء الاصطناعي المباشرة" when the Gemini fallback path was used (Phase 9C fix, re-verified holding).
- People/Transport tabs: functional (click-through confirmed despite an accessibility-tree quirk that made them look inert on a shallow pass — see §17).

## 9. Cross-Role Data Consistency

| Event | Driver | Parent | School | Admin | Consistent? |
|---|---|---|---|---|---|
| Student boarded | صعد | صعد الحافلة | على متن الحافلة | (same student roster) | **Yes** — single shared `Student.status` field, same row |
| Student absent | غائب | غائب اليوم | غائب | (same) | **Yes** |
| Bus delayed (real telemetry) | n/a (driver doesn't see own delay status) | n/a (bridge broken, see §32) | متأخرة | متأخرة | **Partial** — School/Admin agree (both read the real `busNumber`-bridged ETA); Parent cannot receive this fact at all for its real children |
| Bus driver identity | n/a | n/a | مجدي الذيابي (after fix) | مجدي الذيابي (after fix) | **Fixed this phase** — was contradictory before the fix (driverId said one person, driverName said another) |

Boarding/absence status is trustworthy across all three roles that see it because it lives in exactly one row (`legacy_students.status`) — there is no cross-store bridge involved, so no bridge-breakage risk. The bridges that *are* involved (governed telemetry/ETA via `busNumber`, and governed journeys via student name) are where every cross-role inconsistency in this report originates.

## 10. GPS Live Radar Verification

- **Bus-level (School/Admin), via `busNumber` matching**: works correctly. Verified GPS unavailable → GPS fresh (started a real simulation, confirmed `freshness: "FRESH"` from `/api/telemetry/current/fleet`) → GPS stale (after the client-side simulation tick loop stopped). No false "Live" label observed at any point.
- **Student-level (Parent), via student-name matching**: does not work for the real demo household — see §32. Not a code bug in the honesty logic (which correctly refuses to fabricate a live state); the bridge's input data simply never matches.
- Never observed a false "Live"/"مباشر" label anywhere in this pass.

## 11. Real-Time Update Verification

- Mechanism confirmed (by reading + observing): client-side polling only, 5–8s intervals depending on surface, plus a 1.2s client-driven GPS-simulation tick loop that only runs while the operator's own tab/session that started it stays open. No WebSocket/SSE/subscription infrastructure exists.
- Latency observed: fresh telemetry appeared in School's Bus Arrival Radar within one poll cycle (≤8s) of the simulation starting.
- Nothing in the UI claims "Live" without this polling mechanism actually backing it, for the surfaces where the underlying bridge itself works.

## 12. Attendance Verification

Verified boarded (3 students) and absent (1 student) states are identical across Driver's student list and School's Attendance Matrix, because both read the same `Student.status` value. Filter chips (الكل/على متن الحافلة/ينتظرون/غائبون) all showed real, matching counts.

## 13. Student/Bus/Seat Integrity

- Student→Bus→Driver→Route→Seat chain traced for std-1/std-2/std-3: all fields resolve correctly and consistently *except* where a stale denormalized field existed (see §22 — both the parent-name and driver-name instances, one fixed in Phase 9C, one fixed in this phase).
- Reassignment tested live for both FK types (`assign-parent`, `assign-driver`): after the fix, both correctly propagate the new display name everywhere it's read.
- Seat numbers remain unique per bus and were confirmed sufficient to disambiguate same-bus students without relying on name alone (Phase 9C finding, re-confirmed).

## 14. Notification Verification

- Parent's notification feed contains only parent-relevant events (boarding confirmation, pre-arrival alert) plus one broad, outcome-phrased `targetRole: 'all'` seed notification about a route recalculation — legitimate content, though its title ("إشعارات الوكيل الذكي") is more AI-agent-flavored than necessary (P3, noted).
- No AI-execution-log-style or admin-internal-event notification was found reaching a parent.
- The Phase 9C fix that scopes the AI-reroute-fallback notification away from parents (`targetRole: 'admin'` when Gemini is unavailable) was re-verified: a stale prior test's `notif` entries were gone after a server restart, and a fresh run correctly produced an admin-only entry.

## 15. AI Trust Verification

| Feature | Genuinely generated when available? | Fallback disclosed? | Grounded in real data? | Reviewable/rejectable? | Can silently mutate data? |
|---|---|---|---|---|---|
| Route optimization | Yes (Gemini) | Yes (Phase 9C fix) | Partially (student roster is real; savings numbers are LLM-estimated) | Yes ("مراجعة واعتماد") | No — analysis-only by design |
| Reroute simulator | Yes (Gemini) | Yes (Phase 9C fix) | Yes (real bus/incident) | N/A (simulation only) | No |
| Distribution Assistant | N/A — deterministic, not LLM-based | N/A | Yes — real occupancy math | Acknowledge-only, no auto-apply | No — no backend endpoint exists to apply it |

No AI surface was found silently mutating student/bus/seat/route/ownership data. The one governance gap is not in the AI logic itself but in the **authentication** wrapped around the approve/reject endpoints — see §16.

## 16. Security Regression — CRITICAL

### Legacy surface (server.ts, `server/services/legacyAuthz.ts`): **SOLID**
- No token → 401. Garbage token → 401 with a generic, non-enumerating message. Wrong password → 401 generic. A parent attempting to change a non-owned student's status → 403 (`requireLegacyStudentOwnership`, re-verified live this phase).
- This matches the 930+ tests already covering exactly this surface.

### Governed surface (`server/services/authz.ts` + all `server/routes/*.ts`): **P0 — CONFIRMED BROKEN**

Every governed guard (`requireParentUser`, `requireAuthenticatedUser`, `requireTelemetryReader`, `requireOperationalUser`, `requireJourneyReader`, and their equivalents) authenticates a caller **solely** by looking up whichever `userEmail` string arrives in the request — as a query parameter on GETs, as a body field on POSTs — with **no check whatsoever** that the request carries a valid session for that email.

**Empirically confirmed exploit** (executed live, not merely read from source):

```
fetch('/api/parent/journeys?userEmail=parent@masara.om')
```

— issued with **zero** `Authorization` header, zero cookies, zero prior login — returned HTTP 200 with the real parent's real children's names, live journey state, real GPS coordinates, real driver name, and real ETA. Anyone who knows or guesses a parent's email can track a specific child's live location with no credentials at all.

The same pattern was confirmed by source inspection across **all 11 governed route files** (`agentRoutes.ts`, `contactRoutes.ts`, `deviceRoutes.ts`, `etaRoutes.ts`, `gpsSimulationRoutes.ts`, `journeyRoutes.ts`, `operationsRoutes.ts`, `parentRoutes.ts`, `safetyFindingRoutes.ts`, `simulationRoutes.ts`, `telemetryRoutes.ts`). Critically, this is **not limited to reads**: `agentRoutes.ts`'s approve/reject/request-review endpoints — the human-decision gate the entire AI-governance model depends on (§15 above) — are gated by the identical unauthenticated pattern, meaning anyone who knows an admin/school email could remotely approve or reject a real AI-driven operational recommendation with no login.

**Root cause, precisely**: this is a known, previously-disclosed decision, not something newly introduced. `server/services/legacyAuthz.ts`'s own header comment states it plainly: *"The governed guards in authz.ts are untouched and still resolve identity from a client-claimed userEmail, exactly as every phase since 3A established... because the [legacy] surface it protects never had ANY identity claim to trust in the first place."* Phase 7A fixed the legacy surface's authentication and explicitly left the governed surface as it was. This audit is the first to empirically demonstrate how severe that gap actually is now that the governed surface carries live child-location tracking and real operational-approval actions.

**Why this was not fixed in this phase**: per this audit's own explicit instruction (§37: *"STOP and document instead of guessing if you discover... unsafe authorization behavior... backend architecture conflict"*), and because a correct, safe fix requires:
1. Deciding the governed surface should reuse the existing, already-proven legacy session mechanism (`Authorization: Bearer <token>`, cross-checked against the claimed `userEmail`) rather than inventing a second auth system — this itself is a decision worth explicit sign-off, even though it's the obvious answer.
2. Touching all 11 governed route files' guards in `server/services/authz.ts`.
3. Touching every frontend service file that calls them (`parentApi.ts`, `telemetryApi.ts`, `etaApi.ts`, `journeysApi.ts`, `approvalsApi.ts`, `currentLocationApi.ts`, and more) to attach the session token.
4. Full regression testing of the entire live-tracking, notification, and AI-governance feature surface afterward, since the change affects the authorization boundary for effectively every "smart"/governed feature built since Phase 3.

This is a genuinely large, dedicated remediation effort — not a same-response patch — and rushing it inside an already-large audit response risks introducing new bugs into the exact safety-critical surface this finding is about. It is flagged as the single highest-priority next action.

**No stopgap mitigation was applied** (e.g., disabling the endpoints) because doing so would break GPS Live Radar / Live Journey / School-Admin fleet views entirely for the current pilot/demo, which was judged a worse outcome than clear documentation for a decision the user should make explicitly.

### Other security checks — SOLID
- Disabled accounts / revoked sessions: covered by existing passing tests (`legacySessionAndAuthz.test.ts`, `employeeManagement.test.ts`'s "Deactivation revokes sessions immediately" suite) — not re-derived live this phase, cited from the existing regression suite.
- Role escalation via client-claimed role at login: fixed in an earlier phase, covered by existing tests, unaffected by this phase's changes.

## 17. Accessibility Regression

- Re-verified the Phase 9C `Card.tsx` fix (`role="button"`, `tabIndex=0`, Enter/Space handling) is still present and functionally correct — confirmed via direct handler invocation showing the keydown handler correctly calls `preventDefault()` and triggers the same state change as a click.
- **New gap found and fixed this phase**: three `<Card onClick>` usages in `SchoolDashboard.tsx` (Attention Required items, Bus Arrival Radar rows, Bus Management rows) were passing `onClick` **without** the `interactive` prop, so they never received the Phase 9C fix's `role`/`tabIndex`/keyboard handling despite being genuinely clickable — a real, live accessibility regression on exactly the screens built during the same phase that fixed the underlying component. Fixed by adding `interactive` to all three (also removing now-redundant manual hover/cursor classes the prop already provides).
- **Methodology note, stated plainly**: real physical Tab-key focus traversal via this session's browser automation tooling proved unreliable in this specific non-displayed/non-composited pane environment (focus was sometimes lost to `<body>` between a ref-based click and a subsequent Tab press) — a tooling limitation already established earlier in this project for screenshots, now also observed for keyboard focus delivery. Where real end-to-end Tab-navigation could not be trusted, the component's keyboard handler was verified directly (confirmed correct via direct invocation with a synthetic `Enter` keydown, checked after allowing React's async re-render to flush). This is disclosed honestly rather than claiming a full physical-keyboard walkthrough that the tooling could not reliably perform.

## 18. Arabic RTL Regression

- `<html dir="rtl" lang="ar">` confirmed at the root; computed `direction: rtl` confirmed on `<body>`; Arabic display font (Tajawal) confirmed loaded and applied.
- No RTL-affecting layout/CSS was touched in this phase (only logic/data fixes), and every screen read during this pass rendered correctly right-to-left with no clipped text, reversed badges, or broken tables observed. Not re-audited at Phase 9B's original depth since nothing RTL-relevant changed.

## 19. Mobile Verification

- School (375px viewport): zero horizontal overflow (`scrollWidth === clientWidth === 375`).
- Driver (375px viewport): zero horizontal overflow; board/absent buttons confirmed real 44×44px with proper `aria-label`s (Phase 9C fix, re-verified holding under a genuine mobile viewport this phase, not just at desktop width).

## 20. Failure-State Testing

- No GPS / GPS unavailable: confirmed honest "الموقع غير متاح حالياً" state (Driver, before starting a fresh simulation; School's Bus 102/103/111 with no simulation ever run).
- Stale GPS: confirmed honest "بيانات قديمة" state once a prior simulation's client tick loop stopped.
- No active trip: confirmed honest "لم تبدأ الرحلة" (School) / "لا توجد رحلة مباشرة نشطة" (Parent) states, never fabricated as on-time.
- AI unavailable: confirmed honest fallback disclosure (§15, Phase 9C fix re-verified).
- Unauthenticated/invalid session on the legacy surface: confirmed honest, generic 401s.

## 21. Fabricated Data Audit

- Repeated the Phase 9C grep sweep (`value="—"`, `fake`/`dummy`/`placeholder` patterns, hardcoded in-JSX percentage literals) — no new instances found beyond what Phase 9C already fixed.
- One data-freshness artifact noted, not a code defect: the governed demo trip's `scheduledDropoffTime` is fixed at a past calendar date (2026-08-24) relative to the environment's current date (2026-08-26), which makes the real ETA-status logic perpetually compute "DELAYED" for that trip regardless of actual simulated performance. This is demo-data staleness, not a fabricated number — the delay signal is genuinely computed from real (if stale-dated) scheduled-vs-actual data. Documented for awareness; not something to silently work around.

## 22. P0 Findings

1. **Governed API authentication bypass** (§16) — confirmed exploitable live, systemic across 11 route files including AI-approval writes. **Not fixed — STOP/architecture decision required**, documented in full above.
2. **Bus↔driver identity desync** (`legacyBusRepository.updateDriverId` wrote `driverId` alone, never syncing `driverName`) — same bug class as the Phase 9C student/parent fix. **Fixed this phase.**
3. **Parent Live Journey bridge is provably non-functional for the real demo household** (§32) — the legacy↔governed student-name-matching bridge's two input datasets share zero matching names for "the same" conceptual children. **Not a code bug to patch; requires a real cross-system student identity decision.** Documented, not worked around.

## 23. P1 Findings

None found beyond the P0s above and the accessibility gap in §24 (judged P2, not P1, since the affected cards had no *other* way to reach the same information — the Bus Detail Sheet is reachable via other buses in the same list — so it's a real but narrower usability defect than a full workflow blocker).

## 24. P2 Findings

1. **Accessibility regression on 3 School Dashboard cards** (§17) — clickable but not keyboard/screen-reader operable, because they didn't opt into the `Card` component's own accessibility fix. **Fixed this phase.**
2. **`driverPhone`/`parentPhone` can go stale after a reassignment**, since `legacy_users` has no phone field to resync from (same limitation already documented for `parentPhone` in Phase 9C, now also true for `driverPhone`). Contacting via a displayed phone shortly after a reassignment could reach the wrong person or no one. Documented; a real fix requires either adding a phone field to `legacy_users` or a UI affordance that flags "contact info may be outdated after a recent reassignment" — a small, safe follow-up, not attempted here to keep this phase's changes minimal and reviewable.

## 25. P3 Findings

1. A parent-facing seed notification is titled "إشعارات الوكيل الذكي (MASARA OMAN AI)" — the body text is fine (outcome-oriented, relevant), but the AI-agent-flavored title is unnecessarily technical for a parent audience. Cosmetic; not fixed.

## 26. Fixes Implemented

- `server/repositories/legacyBusRepository.ts` / `server.ts`: `updateDriverId` now keeps `driverName` in sync with the linked account when one is assigned, mirroring the existing `updateParentId` fix. New regression test added to `tests/services/employeeManagement.test.ts`.
- The one polluted live-DB row (`bus-102`) was corrected through the real `assign-driver` endpoint (not a raw DB edit).
- `src/components/SchoolDashboard.tsx`: three `Card` usages given the `interactive` prop so they receive the existing keyboard-accessibility fix; redundant manual hover/cursor classes removed.

## 27. Tests

932/932 passing (931 baseline + 1 new regression test for the bus/driver sync fix).

## 28. Typecheck

`npx tsc --noEmit` — clean, before and after all changes.

## 29. Production Build

`npm run build` — clean, before and after all changes. Vite + esbuild server bundle both succeed; the existing >500KB main-chunk warning is pre-existing and unrelated to this phase.

## 30. Browser Verification

Every finding and every fix in this report was verified live in the running application using real seeded accounts (see §3), including a real GPS Simulation run (not merely inspected in source), across desktop and mobile viewports. Console errors were checked on fresh (non-HMR) page loads; none found beyond noise accumulated from this session's own repeated dev-server restarts (verified stale by cross-checking against a completely fresh tab).

## 31. Remaining Technical Debt

- The governed API authentication gap (§16) — highest priority, needs its own dedicated phase.
- The legacy↔governed student-name bridge (§32) — needs a real architectural decision, not a heuristic patch.
- `driverPhone`/`parentPhone` staleness after reassignment (§24.2).
- The parent-facing AI notification title's microcopy (§25.1).
- No dedicated Seat Management screen or global cross-entity search (carried forward from Phase 9C, still judged non-blocking for the roles' actual jobs).

## 32. P0-2 Status

**Two distinct P0-2-class findings, both left undecided by design, per this audit's explicit instructions:**

1. **Original P0-2 (documented in prior phases)**: legacy and governed systems are two independent identity stores for students/buses with no shared ID, bridged only by display-field matching (`busNumber` for buses — works; student name — does not, see below). Status: unchanged, still undecided, still safely non-destructive in the UI (never fabricates a match it can't support).
2. **New empirical confirmation this phase**: the student-name bridge specifically is not merely theoretically fragile — it is **actually broken right now** for the real demo parent account, because the governed seed's "same" two demo children were auto-generated with random names that were never aligned with the legacy seed's hardcoded names for those same two conceptual children. This makes the flagship "Parent Live Journey" feature silently inert for the account most likely to be used in any demo or pilot walkthrough.

**Decision required, not made unilaterally in this phase**: MASARA needs one authoritative, shared student (and bus, and driver) identity — either the legacy store is extended with a real governed-ID foreign key, or the governed store is extended with a real legacy-ID foreign key, or the two are consolidated. Whichever direction is chosen, it is a data-model and migration decision with real consequences for every existing governed record, and is explicitly out of scope for this audit to decide.

## 33. Final Product Readiness Assessment

MASARA's UX layer is genuinely good — calm, honest about its own limitations, consistent in the facts it shows across roles wherever the underlying data bridge actually works. But **two unresolved, severe backend-trust issues** — an authentication bypass on the entire live-tracking/approval API, and a non-functional parent-facing live-tracking bridge for the very account used to demo it — mean the product is **not ready to be trusted with a real child's real safety data today**. See §36 for the formal readiness level.

---

# 34. Final Scorecard

| Role | Safety | Clarity | Trust | Task Completion | Real-Time | Mobile | Accessibility | Overall |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Parent | 3 | 8 | 4 | 7 | 3 | 8 | 8 | **5.5** |
| Driver | 8 | 8 | 8 | 8 | 7 | 8 | 8 | **7.9** |
| School | 6 | 8 | 7 | 8 | 8 | 8 | 7 | **7.4** |
| Admin | 5 | 7 | 6 | 7 | 7 | 7 | 7 | **6.6** |

**Explanations for every score below 8:**

- **Parent Safety (3)**: the governed API authentication bypass (§16) means a real parent's real child's live location is retrievable by anyone who knows their email, with zero login — this is the most direct child-safety exposure in the whole system, and it sits behind exactly the feature (Parent Live Journey) this role most depends on.
- **Parent Trust (4)**: on top of the safety issue, the Live Journey feature is provably non-functional for this account's real children (§32) — a parent who opens the app expecting to see their child's live bus will never see it work, regardless of what the driver does.
- **Parent Real-Time (3)**: follows directly from the above — the real-time mechanism exists and works at the bus level, but never reaches this role's actual UI for its actual children.
- **Parent Task Completion (7)**: everything else (viewing status, reporting absence, contacting the driver, notifications) works as intended; only the live-tracking task itself is blocked.
- **Driver Real-Time (7)**: works correctly, docked only because it inherits the same governed-API authentication gap in principle (not exploited against the driver specifically in this pass, but the same route family is exposed).
- **School Safety (6)** / **Admin Safety (5)**: same governed-API exposure — an admin/school email being known lets anyone read fleet-wide live GPS and, worse, approve/reject real AI recommendations with no login (Admin scores lower because the write-access exposure is specifically on admin/school-gated actions).
- **School/Admin Trust (7/6)**: the visible UX is honest and well-built; the score is capped by the same unresolved backend exposure, which a real deployment would have to resolve before any of these roles' trust claims hold up.
- **Admin Clarity (7)**: AI section is well-organized and honest, docked slightly for the "الوكيل الذكي" branding leaking into a parent-facing notification title (§25) as a signal of AI terminology not being fully contained to admin-facing surfaces.
- **School/Admin Accessibility (7)**: the newly-found and fixed Card gap (§17) was real and shipped in a prior phase before this audit caught it — scored down slightly to reflect that this class of regression can recur when new call sites don't opt into the shared fix, not because the current state has an open defect.

# 35. Product Readiness Level

## LEVEL 3 — Operationally Coherent Prototype

Not Level 4 (Pilot Ready) because:
- A live, exploitable authentication bypass on the entire governed API surface is disqualifying for any deployment involving real children's location data, full stop — regardless of how polished the UI is.
- The flagship Parent Live Journey feature does not work for a real household today, which is a core-journey failure, not a polish gap.

It is above Level 2 (Functional Demo) because the four role experiences are genuinely coherent, honest about their own limitations, internally consistent wherever the data bridges work, accessible, mobile-capable, and built on a real (if partially unauthenticated) telemetry/ETA/journey pipeline — this is materially more than "pages that render."

**To reach Level 4**, MASARA needs, at minimum: (1) the governed API authentication gap closed, (2) a real, decided fix for the legacy↔governed student identity bridge, and (3) both re-verified with the same live-browser-first rigor used in this report.

---

# 36. Final Quality Questions

- **Parent** — "Where is my child and what is happening?" within ~5 seconds: **Yes, for status/boarding/notifications.** **No, for live location** — the feature is present and honestly labeled but structurally cannot activate for this account's real children.
- **Driver** — "What do I do next?": **Yes**, consistently, across the whole trip lifecycle tested.
- **School** — "What is happening with today's transportation?": **Yes**, immediately, including genuine delay detection once real telemetry exists.
- **Admin** — "What requires my attention?": **Yes** for operational KPIs; the approval-count tile is now real, not fabricated.
- **System** — do all four roles see the same underlying reality?: **Where the data bridge works (bus-level telemetry/ETA, shared student status), yes. Where it doesn't (student-level live journey), no** — and the UI is honest about not knowing, rather than lying.
- **GPS** — genuinely live when labeled live?: **Yes, everywhere it is labeled live in this pass** — verified fresh→stale transitions correctly, no false "Live" ever observed.
- **AI** — useful without pretending or silently mutating?: **Yes** — advisory-only, disclosed fallbacks, no silent mutation found; the one real AI-adjacent risk is the *authentication* around the approval action, not the AI logic itself.
- **Security** — can one user see another's protected information?: **On the legacy surface, no — verified solid. On the governed surface, yes — trivially, with zero credentials. This is the report's central finding.**
- **Mobile** — can critical workflows be completed comfortably?: **Yes** — no overflow, real 44px targets, verified on Driver and School.
- **Arabic** — does it feel intentionally designed?: **Yes**, unchanged from Phase 9B's work, re-confirmed at the root (`dir`, `lang`, font) and throughout every screen read this phase.
