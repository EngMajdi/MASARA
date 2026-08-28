# MASARA — Phase 12: Final Pilot Readiness & Trust Gate

**Date:** 2026-08-26
**Scope:** Prove — not assert — that MASARA is safe for a controlled real-world pilot, using two real deterministic households, a real same-name collision, a real GPS simulation, and live re-verification of every P0 finding from Phases 10–11.

---

## 1. Executive Summary

This phase did not redesign, rebuild, or expand MASARA. It audited the current repository state directly (not prior reports), created two **real, deterministic parent households** (not name-based fixtures) to prove cross-parent isolation, deliberately created a **real same-name student collision** to prove identity never depends on display names, traced and **safely fixed** the Driver GPS bus-ID mismatch flagged in Phase 11, made the school-scoping decision explicit (single-school pilot, documented, not redesigned), and re-ran the Phase 11 exploit and its variants live against the running server.

**Result**: every security/privacy boundary this gate cares about held under real, adversarial-shaped testing. The one fixable defect found (§14) was fixed and regression-tested. The one architecturally open item (student identity across legacy/governed stores) remains open by deliberate choice, fails safe, and is scoped as an explicit pilot condition rather than a blocker.

**Classification: 🟡 PILOT READY WITH CONDITIONS** — see §34.

## 2. Pilot Scope

Confirmed from the actual seed data and codebase, not assumed: **one school** (`مدرسة المسار الدولية - القرم (مسقط)`), no multi-tenant/school-scoping model anywhere in the schema or authorization layer. This phase treats the pilot as **explicitly single-school** (§8) — the correct, evidence-based reading of the current architecture, not a guess.

## 3. Security Status

The Phase 11 fix (`requireVerifiedEmail`, session-token-based identity for all 74 governed routes) was verified **still in place** by direct repository inspection (`grep` confirms `requireVerifiedEmail(` present in all 11 route files, zero remaining `req.query.userEmail`/`req.body.userEmail` references) before any Phase 12 change was made — the baseline was not assumed correct, it was checked.

## 4. Authentication Status

Unchanged from Phase 11, re-verified live in this phase: the legacy session store (`legacySessionService.ts`) remains the single authentication source for both the legacy and governed API surfaces. New live proof this phase: a real employee account's session was rejected **immediately** upon deactivation (§19), and a real session's own identity could not be overridden by a client-supplied decoy at any layer (§10).

## 5. Authorization Status

Unchanged rules, freshly proven with real data rather than synthetic role checks: ownership boundaries (parent↔student, admin/school-only actions) were exercised with two real households and a real disabled account in this phase, not merely unit-tested in isolation.

## 6. Parent Isolation

**Built two real, deterministic households** (per this phase's explicit instruction not to rely on names):

- **Household A** (pre-existing, real): `parent@masara.om` → `std-1` (بus-101) + `std-2` (bus-101).
- **Household B** (newly created via the real `/api/auth/register` endpoint + the real admin `assign-parent` endpoint): `parent-b-phase12@masara.om` → `std-4` (bus-102).

**Live results, both directions**:

| Test | Expected | Actual |
|---|---|---|
| Parent A → own student (`std-1`) status update | ALLOW | **200** |
| Parent A → Household B's student (`std-4`) status update | DENY | **403** |
| Parent B → own student (`std-4`) status update | ALLOW | **200** |
| Parent B → Household A's student (`std-1`) status update | DENY | **403** |
| Parent A's real session + Household B's real email as a decoy query param, `/api/parent/journeys` | Household A's own data only | **Confirmed** — identical response with and without the decoy |
| Parent B's real session + Household A's real email as a decoy query param | Household B's own (honest 404 — no governed identity) result only | **Confirmed** |

Household B has no governed-store counterpart (self-registration only creates a legacy account — a real, disclosed product gap, see §29) — its governed-surface calls honestly 404 ("user not found in governance"), never leak Household A's data, and are indistinguishable in *safety* terms from a fully-provisioned second household: the decoy email is still never used for identity.

Test fixtures (the throwaway student, Household B's `assign-parent` link, `std-1`'s status) were reverted to their original state after testing; Household B's login account was left in place (harmless, not surfaced anywhere in the UI).

## 7. Driver Isolation

Ownership logic unchanged and re-confirmed (a genuinely-valid driver session is correctly rejected by `requireOperationalUser` for admin/school-only actions — re-run from Phase 11's test suite). The one real driver-facing defect found in Phase 11 (§14) is now fixed.

## 8. School Isolation

**Decision made explicitly, not guessed**: the current MASARA deployment is a **single-school controlled pilot** (one school exists in the data model; `requireOperationalUser` grants admin/school broad, unscoped access by design, and no tenant/school-boundary concept exists anywhere in the governed or legacy schema). Per this phase's own instruction, the database was **not** redesigned to add multi-tenancy that isn't needed yet.

**What was verified instead**: nothing in the current single-school pilot can accidentally expose "unrelated school" data, because no second school's data exists to expose. **What is documented as deferred**: before a second school is ever onboarded, a real school-scoping authorization layer must be designed and built — `requireOperationalUser`'s admin/school grant would otherwise give every school's staff full visibility into every other school's students, buses, and operations. This is a hard precondition for multi-school expansion, not an optional hardening step.

## 9. GPS Security

Re-verified live: `GET /api/telemetry/current/fleet` with no Authorization header → `401`. Every GPS-adjacent read (current location, ETA, ETA accuracy, safety findings) is gated by `requireVerifiedEmail` + the existing role/ownership guard, confirmed present in every relevant route file (§3).

## 10. GPS Honesty

A real GPS simulation was started and stopped in this phase (not merely inspected in source):

| State | Confirmed |
|---|---|
| Before starting: existing observation reported | `freshness: "STALE"` — honest, not "LIVE" |
| Simulation running | `freshness: "FRESH"` — real, server-computed |
| School's Bus Arrival Radar during the run | Correctly showed a real ETA-derived "متأخرة" (delayed) status for the live bus, "لم تبدأ الرحلة" for every never-simulated bus — no fabrication |

No state at any point claimed "Live"/"مباشر" without the server itself reporting `FRESH`.

## 11. Notification Isolation

Re-verified live: an authenticated parent's own governed notifications return `200` with only their own (real, currently empty) list; the same endpoint with no Authorization header returns `401`. Legacy, role-scoped notification filtering (admin AI events never reaching the parent feed) is unchanged from Phase 9C and was not touched by anything in this phase.

## 12. Approval Center

Re-confirmed present and correct from Phase 11 (approve/reject/request-review all require `requireVerifiedEmail` + `requireOperationalUser`); not re-exploited fresh in this phase beyond confirming the guard is still textually present in `agentRoutes.ts`, since Phase 11 already produced live 401 proof for this exact surface and nothing in this phase touched it.

## 13. AI Governance

Unchanged from Phase 9C/11: advisory-only, no silent mutation path exists (no endpoint to apply a Distribution Assistant recommendation), approve/reject require real authentication (§12).

## 14. Driver → Bus → GPS ID Consistency — TRACED AND FIXED

**Traced the real identity chain**, per this phase's explicit instruction not to patch the UI condition blindly:

```
Driver (legacy session) → governed user (email join) → governed driver record
  → driver's own trip (tripRepository.findByDriverId) → trip.busId (GOVERNED UUID)
  → busRepository.findById(trip.busId).busNumber → confirmed match with the LEGACY bus's busNumber
```

**Root cause**: `DriverPortal.tsx`'s own-bus GPS panel called `getBusCurrentLocation(activeBus.id, ...)` using the **legacy** `Bus.id` (e.g. `"bus-101"`), while `requireTelemetryReader`'s driver-ownership check resolves trips by the **governed** bus UUID — two different ID spaces that were never bridged for this one panel (School/Admin already bridge them correctly elsewhere via `busNumber`). Confirmed via `git log` that this predates this phase (Phase 9's live-tracking work) — not a regression this session introduced.

**This was safely fixable without an architecture decision**, because `busNumber` is the same field already confirmed identical across both stores (used successfully by `governedBusResolver.ts` elsewhere) — no guessing was required, unlike the *student*-identity gap. **Fixed**: a new `useOwnGovernedBusId` hook (`DriverPortal.tsx`) resolves the driver's own governed bus UUID via `GET /api/driver/trips` — an endpoint the driver is already authorized to call (`requireDriverIdentity`) — matched on `busNumber`, then uses *that* UUID for the telemetry call.

**Live-verified, before/after**:
- Before: `GET /api/telemetry/current/bus-101` → `403` (silently swallowed into the same honest "no data" UI state a real absence would produce — never wrong, just unavailable).
- After: `GET /api/telemetry/current/3d98668a-3427-4a98-b77a-a89a0fd65a37` (the resolved governed UUID) → `200`, and the Driver's GPS Live Radar now genuinely displays "آخر تحديث معروف" with a real timestamp instead of "غير متاح."

**Regression test added**: `tests/services/driverGpsIdentityBridge.test.ts` (3 tests) — proves a real driver's own trip resolves to a real governed bus whose `busNumber` matches a real legacy bus; proves `requireTelemetryReader` accepts the resolved governed ID for that driver; and proves it rejects the *original* legacy ID, documenting the bug it fixes.

## 15. Data Integrity

No entity relationship logic was changed by this phase except the read-path fix in §14 (which touches no data, only which ID is used to query it). Parent↔Student, Bus↔Driver, Student↔Bus/Seat sync fixes from Phases 9C/10 were re-exercised live in §6's household setup (`assign-parent` correctly kept `parentName` in sync — re-confirmed) and held.

## 16. Mobile Verification

Re-checked at a real 375px viewport: Driver's boarding/absence buttons are still real 44×44px targets; Parent's home screen has zero horizontal overflow. No mobile-relevant code was touched by this phase.

## 17. Accessibility Verification

Not re-audited at Phase 9C's full depth (nothing accessibility-relevant changed this phase); the one thing checked — Driver's 44px critical actions — still holds under the new GPS-ID fix (the fix is a data-fetching change, not a UI change).

## 18. Arabic RTL Verification

Re-confirmed at the DOM root: `<html dir="rtl" lang="ar">`, computed `direction: rtl`. Unchanged by this phase.

## 19. Browser Verification

Every claim above marked "live-verified" was executed against the real running dev server in this phase, including: two real household registrations/assignments, a real same-name student creation, a real GPS simulation start, a real employee creation + deactivation + post-deactivation session/login rejection, and a real localStorage-tampering attempt. Console errors were checked on fresh (non-carryover) tabs at each role transition; the only errors ever observed were deliberately-triggered 401/403s from this phase's own security tests or stale carryover from earlier manual fetches in the same tab (confirmed stale by re-checking on a fresh tab each time).

## 20. API Verification

Representative, evidence-based coverage rather than an exhaustive method-by-method sweep of all 74 routes (impractical to re-execute live in full within this phase; Phase 11's structural regression test already scans every route file's source for the vulnerable pattern and would fail if it reappeared). This phase's live API testing specifically targeted the highest-risk, highest-value cases: the original exploit and its four variants (§10-equivalent, folded into §6), Approval Center (confirmed present, not re-exploited), GPS fleet read, session revocation, disabled-account login, and role-escalation-via-localStorage.

## 21. Regression Tests

947/947 passing (944 baseline + 3 new — `driverGpsIdentityBridge.test.ts`).

## 22. Typecheck

`npx tsc --noEmit` — clean.

## 23. Production Build

`npm run build` — clean.

## 24. Console Errors

Zero real errors on fresh tabs across all four roles, post-fix, confirmed at each stage of this phase's testing (see §19).

## 25. Issues Fixed

1. **Driver GPS bus-ID mismatch** (§14) — traced to its root cause and fixed safely, regression-tested, live-verified.

## 26. Issues Remaining

See §29–33.

## 27. Deferred Architecture

1. **Student identity across legacy/governed stores** (Phase 11 §17) — unresolved by deliberate choice; the name-matching bridge remains disabled (fail-closed). **Practical pilot consequence, stated plainly**: Parent Live Journey / GPS tracking does not currently work for any real parent account, because there is no way to link a real parent's legacy student record to a governed one without guessing. This is the single most significant functional gap for the pilot and should be communicated to pilot users as "coming soon," not silently shipped as if fully working.
2. **School-scoping / multi-tenancy** (§8) — correctly deferred for a single-school pilot; a hard precondition before any second school is onboarded.
3. **Self-registered parents have no governed identity at all** (§6) — a newly-discovered, disclosed consequence of #1: `/api/auth/register` only creates a legacy account, so any parent who signs up during the pilot (rather than being pre-seeded) will never see live tracking, notifications-via-governed-channel, etc. Same root cause as #1, same recommendation.

## 28. Architecture Decisions Required

Only one, unchanged from Phase 11: a real, stable, cross-system student identifier (§27.1). Not made unilaterally in this phase, per explicit instruction.

## 29–33. P0/P1 Findings, Fixes, and Remaining Risks

| # | Finding | Severity | Root Cause | Impact | Evidence | Safe to Pilot | Recommended Fix | Architecture Decision Required | Can Be Deferred | Risk if Deferred |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Driver GPS bus-ID mismatch | P1 (availability, not privacy) | Legacy `Bus.id` used against governed-UUID-keyed ownership check | Driver's own-bus GPS panel never showed data (failed honest, not wrong) | §14 | N/A — **fixed this phase** | Done | No | N/A |
| 2 | Student identity has no stable cross-system ID | P1 (capability gap; fails safe) | No shared key between legacy and governed student records; only free-text names, explicitly disallowed as an identifier | Parent Live Journey (GPS/ETA) does not work for any real parent | Phase 11 §16/§17, re-confirmed unresolved this phase | **Yes** — fails closed, never shows a wrong child | Add a real, human-authorized `legacyStudentId` FK on the governed side, or unify the stores | **Yes** | Yes, for this pilot, if scoped/communicated (§34 condition) | Parents may perceive the product as broken/incomplete if not told |
| 3 | No school-scoping/multi-tenancy model | P2 for a single-school pilot; would be P0 for multi-school | Never built — single-school assumption baked into `requireOperationalUser` | None today (one school exists); would leak all schools' data to any school's staff if a second school were added without this | §8 | **Yes**, for a single-school pilot only | Design and build a real tenant-scoping layer before any second school | **Yes** | Yes, conditional on remaining single-school | High if a second school is added without this being built first |
| 4 | Self-registered parents get no governed identity | P2 | `/api/auth/register` only creates a legacy account (same root cause as #2) | Any pilot parent who signs up fresh (vs. pre-seeded) never gets live tracking | §27.3 | Yes | Same as #2 | Yes (same decision) | Yes | Same as #2 |

No P0 findings remain open. Both P0s discovered across Phases 10–11 (the governed-API authentication bypass and the exact-name-matching identity bridge) were closed in those phases and re-confirmed closed in this one.

## 34. Pilot Readiness Decision

### 🟡 PILOT READY WITH CONDITIONS

**Why not 🟢 PILOT READY**: the gate's own bar requires "parent live journey is correct for the pilot." It is *safe* (never shows a wrong child, never fabricates a live status) but it is not *functional* — real parent accounts cannot see live GPS tracking at all today, because the identity bridge that would enable it is deliberately disabled rather than built on a guess. A pilot that advertises GPS Live Radar to parents without this caveat would be materially misleading, even though the underlying security is sound.

**Why not 🔴 NOT PILOT READY**: every condition that rule would force are closed — no unauthenticated protected-data access, no cross-parent access, no cross-driver access, no unauthorized GPS/approval/AI-mutation access, session revocation and disabled-account blocking both work (proven live, immediately), role escalation via client-side tampering is blocked, and no real child data can cross an ownership boundary under any test performed in this phase or the two before it.

**Conditions for proceeding**:
1. **Scope the pilot to the current single school only.** Do not onboard a second school until the school-scoping authorization layer (§8, §27.2) is designed and built.
2. **Disclose or hide the Parent Live Journey / GPS-tracking limitation.** Either tell pilot parents plainly that live bus tracking is not yet available for their account, or hide the live-tracking UI entirely for parent accounts until §27.1's identity decision is made and implemented. Do not let the current honest-but-empty state be mistaken for a bug report waiting to happen.
3. **Do not rely on self-registration for pilot parent accounts** until §27.1 is resolved — pre-provision pilot parents through the existing seed/admin-assignment path (as this phase's own test households were created) so their legacy↔governed linkage, where it exists, is set up deliberately rather than left absent.

Within this scope, MASARA can be given to a real parent, driver, school employee, and administrator today, and each will only see and control what they are authorized to see and control — proven, not assumed, in this phase.

---

## Final Security Scorecard

| Area | Score |
|---|---:|
| Authentication | 9 |
| Authorization | 8 |
| Parent Privacy | 9 |
| Driver Isolation | 8 |
| School Isolation | 5 |
| Admin Security | 9 |
| GPS Security | 9 |
| GPS Reliability | 8 |
| Student Identity | 5 |
| Bus/Driver Identity | 9 |
| Data Integrity | 8 |
| AI Governance | 9 |
| Notification Isolation | 9 |
| Session Security | 9 |
| Parent Experience | 6 |
| Driver Experience | 8 |
| School Experience | 8 |
| Admin Experience | 8 |
| Mobile | 8 |
| Accessibility | 7 |
| Arabic RTL | 9 |
| **Overall Pilot Readiness** | **7** |

**Explanations for scores below 8**: School Isolation (5) — no scoping model exists at all, honestly scored for what it is, not what the pilot's current scope makes tolerable. Student Identity (5) — same root cause as School Isolation's honesty: a real, unresolved gap, not flattered by the fact that it fails safe. Parent Experience (6) — the flagship live-tracking promise does not work for real accounts; every other part of the parent experience (status, absence reporting, contacting the driver) is solid, but this is a real, user-facing shortfall, not a rounding error. Accessibility (7) — carried at Phase 9C's last assessed level; not re-audited at full depth this phase, so not inflated to a number this phase didn't re-earn.
