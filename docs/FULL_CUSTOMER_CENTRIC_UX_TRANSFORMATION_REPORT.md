# MASARA — Phase 9B: Full Customer-Centric UX Transformation

**Baseline before this phase:** commit `178e119` (Phase 9 — the earlier cleanup pass), 930/930 tests, clean typecheck/build.
**Directive:** a complete ground-up redesign — new information architecture, new design system, new component system, new navigation per role — not a restyle of the existing layouts. This report documents what was actually rebuilt, verified live, and what was deliberately retained with justification.

---

## 1. Complete page inventory

| Surface | Status |
|---|---|
| Login | Rebuilt — full page, not a modal |
| Global header/shell | Rebuilt — minimal, role-neutral |
| Profile & settings | New (did not exist before) |
| Parent home (children list) | Rebuilt — new IA |
| Parent child detail | New — did not exist as a dedicated view before |
| Parent notifications | Rebuilt — merged two competing notification sources into one |
| Driver trip flow | Rebuilt — new IA (pre-trip → in-progress single flow) |
| School operations center | Rebuilt — new IA (4 sections) |
| Admin operations center | Rebuilt — new IA (4 sections, AI demoted to secondary) |
| Map | Removed as a standalone always-visible page element; re-scoped into Parent child detail, Driver trip, and School fleet tab |
| Notifications (global bell) | Rebuilt as a Sheet |
| AI Advisor | Rebuilt as a Sheet, restyled to light theme |
| Data Management | Rebuilt as a Sheet with sectioned forms |
| Employee Management | Rebuilt as a Sheet with sectioned forms |
| Approval Center | Shell + primitives rebuilt (Sheet, ConfirmDialog, Badge); governed logic untouched |
| Simulation Center | Shell rebuilt (Sheet, Tabs); internal scenario/GPS panels retained as-is (internal QA tool, not a daily-use surface for any role) |
| AI Operations Feed | Fully rebuilt (Sheet + detail Sheet) |
| Journey Detail (governed) | Fully rebuilt (Sheet) |
| Forced password change gate | Rebuilt — full page, consistent with new Login |
| Driver Journey Console (governed) | Retained internally; only its confirmation dialog's shell colors normalized. Folded into Driver's flow as a collapsed secondary "official log," not the primary boarding surface (see §21) |
| School/GPS governed read-model panels (CurrentLocationPanel, EtaPanel, EtaAccuracyPanel, SchoolJourneyOperationsPanel, GpsSimulationPanel, JourneyTimeline, JourneyStatusBadge, NotificationsPanel) | NotificationsPanel fully rebuilt; the rest retained as-is (already token-consistent from the prior phase) and now embedded behind a collapsed "additional detail" toggle in School's fleet tab rather than always-visible stacked cards |

---

## 2. Old information architecture

A single flat page per role: Header (with every admin tool as an always-visible top-bar button) → a global map shown to every role regardless of relevance → a role's entire feature set stacked vertically as cards on one scroll. Parent's "my children" existed as two separate, competing lists (legacy + governed) on the same screen. Admin's landing view was a decorative AI-architecture diagram. There was no per-role navigation model — every screen was "here is everything," not "here is what you came here for."

## 3. New information architecture

Each role now has its own navigation model, built from the actual mental model of that person, not a shared admin-template shell:

- **Parent** — أبنائي (my children, default) → tap a child → dedicated journey detail → الإشعارات (notifications). Account/security under the header avatar.
- **Driver** — one evolving screen: today's trip → (once started) next stop + boarding list. No tab bar — the entire job is one flow, so navigation chrome would only be noise.
- **School** — اليوم (today, default: KPIs + attention) → الأسطول (fleet + map) → الطلاب (students) → المسارات (routes).
- **Admin** — العمليات (operations, default: KPIs + attention) → الأشخاص (people) → النقل (transport/data) → الذكاء الاصطناعي (AI, explicitly secondary).

## 4. Design system

Defined in `src/index.css` as a Tailwind v4 `@theme` semantic layer (not raw hex, not a re-skin): `--color-primary`, `--color-success/warning/danger/info` (+ soft/border variants), `--color-surface`, `--color-canvas`, `--color-border-default/strong`, `--color-text-primary/secondary/tertiary`. Every component in `src/components/ui/` consumes these tokens exclusively — no component reaches for a raw `blue-600` or `slate-950` anymore. Typography discipline: a documented minimum of `text-xs` (12px) everywhere (the old code had 9–11px "micro-fonts" scattered through it), a small set of weight/size combinations for headings vs. body vs. metrics, `font-variant-numeric: tabular-nums` set globally so Arabic-Indic/Latin digit columns in tables and KPI tiles align. Spacing is disciplined to Tailwind's default 4px scale via the component primitives (no more `p-[13px]`-style arbitrary values). No gradients, no glassmorphism, no decorative purple "AI" styling anywhere in the new components — status colors are semantic and used only to mean something.

## 5. Navigation redesign

The old `Header` mixed brand, sync status, 6 competing action buttons, and a role switcher into 3 stacked bars. The new `Header` is one 64px bar: brand + sync dot, notifications, AI help, and an account button that opens `ProfileSheet`. Every role-specific tool (data management, employee management, approvals, simulation, ops feed) moved out of the global header into the role's own section navigation — an admin sees "الأشخاص"/"النقل" inside their own operations center, not a button that also appears (uselessly) on a parent's screen.

## 6. Parent redesign

Full rebuild. `ParentPortal.tsx` now leads with a greeting and a list of the parent's own children (name, live status badge, bus, ETA) — the 5-second test. Tapping a child opens `parent/ChildDetailSheet.tsx`: a `JourneyProgress` visual timeline (Home ● — Bus ● — School ○), pickup point, driver contact (call/WhatsApp), and an absence-report flow using `ConfirmDialog` (a safety-relevant action now gets the app's most obvious confirmation pattern, not a generic modal). The pre-arrival alert scheduler — a notification *preference*, not primary content — moved out of the home screen into the Notifications section, where it belongs.

## 7. Driver redesign

Full rebuild. `DriverPortal.tsx` is one screen that evolves: **pre-trip** shows the route, student count, and a single large "بدء الرحلة" action (behind a `ConfirmDialog` safety checklist); **in-progress** shows real KPIs (boarded/waiting/absent), the next stop, and a scannable student list with one-tap boarding/absence actions plus swipe gestures (`SwipeableCard`, retained). Incident reporting moved to a `Sheet` (a selection task, not a yes/no decision). The governed `DriverJourneyConsole` is folded in as a collapsed "official trip log" — see §21 for why it isn't the primary action surface.

## 8. School redesign

Full rebuild. `SchoolDashboard.tsx` is now an operations center with the four sections from §3. "اليوم" leads with real KPIs (active buses, arrived, absences, attention-needed — computed from actual fuel/safety data, never invented) and an "يحتاج انتباه" list before anything else. "الأسطول" holds the map and the deeper governed telemetry panels behind a collapsed toggle. "الطلاب" is a searchable, filterable roster with a real (not hardcoded partial) grade filter. "المسارات" lists routes with an entry point into Data Management.

## 9. Admin redesign

Full rebuild. `AdminAIAgentPortal.tsx` no longer opens on a decorative AI-architecture diagram. "العمليات" (default) shows the same honest KPI/attention pattern as School, scoped to the fleet. "الأشخاص" and "النقل" are single clear entry points into Employee/Data Management. "الذكاء الاصطناعي" is reached deliberately and now uses the exact "AI Recommendation card" pattern the spec calls for: a plain claim, an expandable "لماذا؟", and an explicit "مراجعة واعتماد" step that hands off to the real Approval Center — never an auto-apply, and never pre-filled with fake analysis before the admin asks for one (the single biggest trust problem in the previous version). The 5-stage pipeline diagram is now a collapsed, admin-opt-in "كيف يعمل النظام" explainer rather than the first thing anyone sees.

## 10. Secondary pages redesign

Notifications, AI Advisor, Data Management, and Employee Management were fully rebuilt onto `Sheet` (a right-docked drawer on desktop, a bottom sheet on mobile) with sectioned forms (`FormSection`/`Field`) instead of one dense wall of inputs. Approval Center and AI Operations Feed were rebuilt onto the same primitives while their governed fetch/decision logic was left untouched (this is real, tested, safety-relevant business logic — restyled, not rewritten). Simulation Center's outer shell was converted to `Sheet`/`Tabs`; its internal scenario/GPS controls were left as-is — it is an internal QA tool no role uses as part of a daily workflow, and the redesign budget was spent on the four primary role experiences instead, per the priority order requested.

## 11. Mobile redesign

Designed mobile-first, not shrunk from desktop. `MobileTabBar` (fixed bottom, safe-area aware, 56px+ touch targets) is the primary navigation for Parent/School/Admin on small screens; `Sheet` renders as a full-width bottom sheet with a drag handle on mobile and a 440px side drawer on desktop from the same component. Every actionable control in the rebuilt surfaces is at least 44px tall. Verified live at a 375×812 viewport: the bottom tab bar renders and the desktop tab strip correctly hides; the sheet lays out at full width, rounded top corners, anchored to the bottom of the viewport (confirmed by direct layout measurement — see §25).

## 12. Arabic/RTL redesign

The product was already RTL-native (Tajawal, `dir="rtl"` at the document level) and this pass kept that foundation while fixing framing that fought it: back/close chevrons now point the RTL-correct direction (`ChevronRight` for "back" reads correctly right-to-left), the `Sheet` drawer opens from the trailing edge (left, in RTL) not a hardcoded "right side" assumption, and `font-variant-numeric: tabular-nums` was added globally so mixed Arabic-label/Latin-digit rows (times, distances, percentages) stay aligned. Phone numbers and English identifiers still render `dir="ltr"` inline where that's correct (a phone number read RTL would be wrong), which was already handled correctly and preserved.

## 13. Accessibility

Every actionable control in the rebuilt surfaces has a real text label or `title`/`aria-label` (see `IconButton`'s required `label` prop — it cannot be used without one). Status is never color-only: `Badge`/`StatusDot` always pair a color with a text label. Minimum touch target of 44px enforced through the `Button`/`IconButton` size scale rather than ad hoc per-screen padding. Not done in this pass: a full contrast-ratio audit or keyboard-navigation walkthrough — this environment does not have reliable access to accessibility-auditing tooling, and it is called out here rather than silently claimed.

## 14. Microcopy

Rewrote user-facing strings across every rebuilt surface to drop internal/English jargon ("GPS Live Radar", "Journey Console", "AI Agent Architecture", "Gemini 2.5 Flash" branding in the footer) in favor of plain Arabic that says what happened and what to do. Error copy is now consistently "تعذّر تحميل هذه المعلومات" + a retry action (`ErrorState`) instead of raw exception text anywhere in the rebuilt components.

## 15. Loading states

`SkeletonLine`/`SkeletonCircle`/`SkeletonCard`/`SkeletonRow` — shaped like the real content they precede — replace the old pattern of briefly rendering stale mock data (`INITIAL_BUSES`/`INITIAL_STUDENTS`) before the first real sync, which was the direct cause of two false-positive "bugs" documented in the earlier Phase 9 audit.

## 16. Empty states

`EmptyState` requires an icon, a title, and (usually) a description — used everywhere a list can legitimately be empty (no children linked, no notifications, no routes, no matching search results) instead of a bare "no data" string or, worse, nothing at all.

## 17. Error states

`ErrorState` is the one error pattern now used across the rebuilt surfaces: a calm icon, "تعذّر تحميل هذه المعلومات", and a "إعادة المحاولة" button — never a stack trace, never a raw `Error:` string surfaced to the user.

## 18. Components created

`Button`, `IconButton`, `Badge`/`StatusDot`, `Card`/`CardHeader`, `Avatar`, `EmptyState`, `ErrorState`, `SkeletonLine`/`Circle`/`Card`/`Row`, `Alert`, `PageHeader`/`SectionHeader`, `Tabs`/`MobileTabBar`, `Sheet`, `ConfirmDialog`, `Field`/`Input`/`Select`/`Textarea`/`FormSection`, `Metric`, `JourneyProgress` — all in `src/components/ui/`, all token-driven, all documented in-line with why they exist.

## 19. Components removed

`ParentJourneyPanel.tsx` deleted outright once nothing referenced it (its useful parts — bus/route/location — were folded into `ChildDetailSheet`'s secondary "السجل الرسمي" section; its notification list was preserved separately as the restyled `NotificationsPanel`, not lost). The old `Header`'s role-switcher UI and admin-tool button row were removed rather than restyled, since the new IA makes them structurally unnecessary.

## 20. Components redesigned

`Header`, `AuthModal` (→ full-page Login), `ForcedPasswordChangeGate`, `ParentPortal`, `DriverPortal`, `SchoolDashboard`, `AdminAIAgentPortal`, `NotificationsModal`, `AdvisorModal`, `DataManagementModal`, `EmployeeManagementModal`, `ApprovalCenter`, `AIOperationsFeed`, `JourneyDetailModal`, `NotificationsPanel`, `MapView` (usage re-scoped, component itself unchanged) — see §1 for the full per-surface breakdown.

## 21. P0-2 status: dual legacy/governed identity store

**Not resolved — and not silently papered over.** The legacy (`students`/`buses`, ownership via `parentId`/`driverId`) and governed (Journey Core, `getParentJourneys`/`getDriverTrips`) systems remain two separate backends with no shared ID space, exactly as documented since Phase 5A. This redesign presents **one coherent UI** on top of that reality rather than making an irreversible backend call:

- **Parent**: the legacy record (real per-child avatar/grade/school/bus/status) is the single primary "my children" list and detail view. The governed journey record is cross-referenced by **exact name match** (not ID — none exists) and folded in as a clearly-labeled, collapsed "السجل الرسمي المباشر" section inside the child detail — never a second competing "my children" list.
- **Driver**: the legacy per-student boarding list is the primary, cross-role-visible action surface (it's the only one that actually updates what parents/school see). The governed `DriverJourneyConsole` is a separate system that does **not** write to the same record, so it is presented as a collapsed "السجل الرسمي للرحلة", not a second boarding UI.

**BACKEND CHANGE REQUIRED**: a real fix — one identity/data model, not two — needs a deliberate backend decision (which store is authoritative, or how they merge) that this phase was explicitly told not to make. Name-matching is correct for the current single-school demo dataset but is not identity-safe at scale (two same-named children in one account would mismatch). This is the single most important recommended next phase.

## 22. Tests

930/930 passing after the full rebuild (verified twice — once mid-rebuild, once at the end). No test was weakened, skipped, or deleted; no new test was required since every change in this pass is presentational/IA, not new backend business logic.

## 23. Typecheck

`npx tsc --noEmit` — clean throughout, checked after every major surface (design system → shell → login → each of the 4 role rebuilds → each secondary page), not just once at the end.

## 24. Build

`npm run build` — clean. Bundle size actually **shrank** versus the previous phase (JS: 1,063KB → 984KB gzip 278KB; CSS: 54KB → 50KB) despite adding an entire component library, because the new shared primitives replaced large amounts of duplicated per-screen markup.

## 25. Browser verification

Live-tested against the running dev server with real seeded data, logged in as each of the four roles:

- **Parent**: greeting + real children list rendered; tapping a child opened the journey-timeline detail sheet with correct pickup/driver/absence controls; the pre-arrival alert fired correctly (functional preservation confirmed).
- **Driver**: in-progress trip view rendered real KPI counts (2 boarded / 1 waiting / 1 absent), next stop, and the operational student list with working tap actions; the collapsed official log toggle present.
- **School**: "اليوم" rendered real KPIs and fleet list; section tabs switched correctly.
- **Admin**: "العمليات" rendered real KPIs; "الذكاء الاصطناعي" rendered the honest empty "لم يُطلب تحليل بعد" prompt state (not fake pre-filled data); Employee Management and Data Management sheets opened and rendered correctly from the new "الأشخاص"/"النقل" entry points; Approval Center sheet opened with its tab list intact.
- **Mobile (375×812)**: confirmed the bottom tab bar is the visible navigation surface and the desktop tab strip is hidden; confirmed by direct `getBoundingClientRect` measurement that the `Sheet` lays out as a full-width, bottom-anchored panel (a CSS-animation-frozen state was investigated and traced to the automation tool's frame-compositing being paused while its preview pane isn't displayed — not a product bug; clearing the transform showed pixel-perfect bottom-sheet positioning).
- A freshly opened, never-hot-reloaded tab was used at each checkpoint to confirm zero real console errors (recurring HMR-reload warnings during live editing were confirmed to be stale artifacts of concurrent file saves, not real defects — the same discipline established in the prior phase's audit).

## 26. Remaining issues

- **P0-2** (§21) — the real fix is a backend decision, explicitly out of scope for this pass.
- Simulation Center's internal scenario/GPS panels and the governed read-model panels (CurrentLocationPanel, EtaPanel, EtaAccuracyPanel, SchoolJourneyOperationsPanel, GpsSimulationPanel, DriverJourneyConsole, JourneyTimeline) were intentionally left at their prior (already token-consistent) styling rather than rebuilt, since they are secondary/internal surfaces now reached through collapsed toggles, and the redesign effort was prioritized on the four primary role experiences per the requested order.
- No formal accessibility audit (contrast ratios, screen-reader pass, keyboard-only navigation) was performed — flagged rather than assumed clean.
- No dedicated Arabic-locale QA beyond what was directly exercised in live verification (numeral formatting, RTL layout, date/time strings) — the areas touched were verified; a systematic sweep of every screen was not performed.
- Bundle size warning from Vite (single JS chunk >500KB) — pre-existing, not introduced or worsened by this pass (in fact improved), not addressed since code-splitting is a separate performance initiative, not a UX one.

## 27. Final UX score (honest, against this phase's own quality bar)

| Question | Answer |
|---|---|
| Parent: can I understand my child's status in 5 seconds? | **Yes** — verified live: greeting + status badge + bus + ETA on the first screen. |
| Driver: can I perform my next action without thinking about the interface? | **Yes** — one primary action is always the visually dominant element (Start Trip, then per-student boarding). |
| School: can I understand today's situation immediately? | **Yes** — real KPIs and an attention list are the first thing rendered. |
| Admin: can I see what needs attention immediately? | **Yes** — operations, not AI architecture, is now the landing section. |
| Everyone: can I use MASARA without understanding how it's built? | **Mostly yes** for every primary flow. The one deliberate exception is the clearly-labeled, opt-in "السجل الرسمي" sections that surface the underlying dual-system reality (§21) — disclosed rather than hidden, and never required reading to complete a task. |

This redesign reconsidered layout, navigation, information architecture, and interaction model for every primary role — not a re-skin of the previous cards with new colors. The three items in §26 are named honestly as unfinished, not claimed as done.

---

# Addendum — Phase 9: Live Tracking, School Operations & AI Distribution Extension

**Directive clarification received after the above:** GPS Live Radar and real-time tracking are core MASARA capabilities, not decoration to be removed — they were to be rebuilt honestly, not hidden. This addendum documents that work. Full architecture findings are in `docs/LIVE_TRACKING_ARCHITECTURE_AUDIT.md` — read alongside this section, not duplicated here.

## Live Tracking

**Architecture finding that shaped everything below:** the old map's bus movement was a client-side `setInterval` animating toward a hardcoded coordinate — cosmetic, never backed by data, never written to the server. It has been removed. A real, already-existing, already-authorized telemetry pipeline (Phase 4A–4E: ingestion → current-location projection with server-computed `FRESH`/`STALE` freshness → ETA with server-computed `confidence`) was already in the codebase and unused for map rendering. This pass wires the UI to that real pipeline instead of inventing anything new.

- **Parent live journey** (`src/components/parent/ChildDetailSheet.tsx`): a promoted, prominent "Live Journey" section sourced exclusively from the already-authorized, parent-safe `GET /api/parent/journeys` (parents are explicitly excluded from the raw telemetry/ETA endpoints server-side — confirmed in the audit, not assumed). Shows a real trip headline derived from the actual `JourneyState` machine, real driver display name, real ETA-in-minutes, the new `LiveRadar` component, and a 5-step "Journey Progress" checklist mapped 1:1 onto real journey states (`scheduled → waiting/boarding → on_bus/in_transit → approaching_stop → dropped_off`) — no invented states. When no live journey exists yet (the common case unless a driver has actually progressed a journey), an honest message is shown instead of a blank or fake map.
- **Driver live bus view** (`DriverPortal.tsx`): a `GPS Live Radar` panel scoped to the driver's own bus via the real, driver-scoped `getBusCurrentLocation`, polled every 5s — the same authorization boundary the telemetry endpoints already enforced.
- **School fleet radar** (`SchoolDashboard.tsx`): a new **Bus Arrival Radar** on "اليوم" — every bus in the roster, each showing a real arrival status (`في الوقت المحدد` / `متأخرة` / `بيانات قديمة` / `لم تبدأ الرحلة`) derived from the real `EtaService` fleet response; a bus absent from that response is honestly labeled "لم تبدأ الرحلة", never guessed as on-time. A collapsible **Live Fleet Radar** (`LiveRadar`, `mode="fleet"`) was added to "الأسطول", expanded by default, showing every bus with genuine current-location data plus the school as destination.
- **Admin operational tracking**: the same Live Fleet Radar was added to Admin's "العمليات" section for parity with School's operational visibility, per the existing (unweakened) admin authorization scope.
- **A genuine dual-identity-store bug found and fixed during live verification of this very work**: the telemetry/ETA services return *governed* bus UUIDs, which share no ID with the *legacy* `Bus.id` (`'bus-101'`, etc.) every other part of the app uses — an early version of the School/Admin radar silently failed to match any bus because of this, always falling back to "لم تبدأ الرحلة" even when real data existed. Fixed via a small resolver (`src/services/governedBusResolver.ts`) that uses the one field confirmed to match exactly across both stores — `busNumber` — never a guess. This is the same class of problem as the parent/student P0-2 finding, now documented for buses too.
- **Collapsible, calm, real**: every radar instance defaults to a compact header (bus/fleet name + freshness badge) and only renders the Leaflet map when the user expands it — verified live at both mobile and desktop widths.

## School Operations Center

- **Bus Arrival Radar** — see above; real ETA-status-driven, not fabricated.
- **Attendance Matrix** (`SchoolDashboard.tsx`, "الطلاب"): rebuilt as a real `<table>` on desktop (Student / Grade / Bus / Seat / **Driver** / Status — the driver column is new, resolved by joining the student's `busNumber` to the real bus roster) with a card fallback on mobile, plus real status filter chips (`الكل` / `على متن الحافلة` / `ينتظرون` / `غائبون`, each showing a real live count) and a search that now also matches by driver name.
- **Bus/seat management**: bus capacity, occupancy, driver, and fuel/safety already surfaced honestly from real `Bus` fields (Phase 9's earlier attention-required logic, retained). A dedicated per-seat roster view (spec §15) was **not** built as a separate screen in this pass — the Attendance Matrix already exposes seat number per student, which was judged sufficient for this pass's time budget; a standalone seat-map visualization is a reasonable next increment, not fabricated as done here.
- **Student Distribution / AI Distribution Assistant** (`src/components/school/DistributionAssistant.tsx`): a new "مساعد التوزيع الذكي" panel on the Students tab. This is a **real, deterministic, fully explainable analysis** over actual bus capacity/occupancy data (buses ≥85% occupied vs. buses ≤70% with free seats) — deliberately **not** a black-box AI call, so "why" is always answerable with exact real numbers. No confidence percentage is shown (per the spec's own §20 instruction not to fabricate one where none is statistically meaningful for a threshold rule). Verified live: with the current, genuinely balanced seed data, it correctly shows "لا توجد توصية توزيع حالياً" rather than manufacturing a recommendation to have something to show.

## AI Distribution — governance

- **Advisory only, confirmed structurally, not just by convention**: the Distribution Assistant has no "Approve → apply" action, because **no backend endpoint exists to reassign a student's bus** (confirmed by inspecting `server.ts` — only `assign-parent` and `assign-driver` exist). This is documented as a concrete `BACKEND CHANGE REQUIRED` in the architecture audit, not silently worked around with a fake mutation or a button that does nothing.
- **Explainability**: every recommendation shows the two real buses involved, their real occupancy percentages, an expandable "لماذا؟" with the exact real numbers that triggered it, and the expected outcome in plain language — matching the spec's What/Why/Expected-outcome structure.
- **Data sources**: exclusively the real `buses` prop (capacity, currentOccupancy) already flowing through the app — no separate AI service call, no new backend surface.

## Real-Time Data Integrity

- **Location source**: the governed telemetry pipeline (`telemetry_observations` → `CurrentLocationProjectionService`), fed in this pilot exclusively by the admin/school-gated GPS Simulation Engine — there is no real GPS device connected. This was true before this phase and is unchanged; this phase's contribution is displaying it honestly instead of not using it.
- **Freshness**: server-computed `FRESH`/`STALE`, surfaced via the new `LiveStatusBadge` — verified live that it correctly flips to "STALE" once a simulation session's client-side tick loop stops (e.g., the operator navigates away), rather than continuing to claim "Live" on data that has gone stale.
- **Update mechanism**: polling only (5–8s intervals depending on surface), consistent with every other live surface already in the app — no WebSocket/SSE/Firebase infrastructure was assumed or introduced.
- **Limitations, disclosed**: trip-level (`trips.status`) has no live transition endpoint today (documented `BACKEND CHANGE REQUIRED` for a real `POST /api/trips/:id/start`); a "traveled path" polyline from real telemetry history is possible with existing data but was not built in this pass; a real GPS device/provider integration remains future work, unchanged from Phase 7F's prior finding.

## Regression

930/930 tests passing, clean typecheck, clean production build — checked after this addendum's changes in addition to the checks already recorded above. Live-verified end-to-end: started a real GPS Simulation session, confirmed the empty state before it started, confirmed the Live Fleet Radar picked up the real position with correct freshness once it was running, confirmed the same data correctly degraded to "STALE" once the simulation stopped, and confirmed the parent's honest "no active live journey" state for a child whose governed Journey was never actually started by the driver (a real, correctly-behaving consequence of the documented dual-system reality, not a bug).

## Follow-up pass — gap closure against the spec's remaining items

On re-checking this addendum item-by-item against the spec (§13, §14, §21, §32), two genuinely missing pieces were identified and built:

- **Bus Management detail drawer** (`src/components/school/BusDetailSheet.tsx`): clicking any bus — in the Bus Arrival Radar list, the new "إدارة الحافلات" list on "الأسطول", or (via the resolver) elsewhere — opens a `Sheet` showing the bus's real status, driver name/phone (tap-to-call), assigned route name (`Bus.assignedRouteId → Route.routeNameAr`), real student count vs. capacity, the same ETA-derived arrival label used by the radar list, a `LiveStatusBadge` for GPS freshness, and any real fuel/safety/near-capacity attention reasons. Two actions — "عرض الطلاب" (switches to the Students tab pre-filtered to that bus's number) and "عرض المسار" (switches to the Routes tab) — replace what would otherwise require separate navigation. Live-verified: opening بحافلة 101 correctly showed its real driver/route/4-of-24 students/STALE GPS; "عرض الطلاب" correctly filtered the Students table to exactly bus 101's 4 real students; opening حافلة 102 (never simulated) correctly showed "الموقع غير متاح حالياً" rather than a fabricated position.
- **Consolidated Attention Required list** (spec §21): "اليوم"'s attention section previously only surfaced fuel/safety flags. It now merges, into one prioritized real list: fuel/safety flags (unchanged), buses whose real fleet-ETA status is `DELAYED`, buses at or above 85% real occupancy (the same threshold already used by the Distribution Assistant), and a real absent-student-count row — each item clickable straight into the relevant view (a bus's detail sheet, or the Students tab pre-filtered to absent). The "يحتاج انتباه" KPI tile count now reflects this same combined list instead of only fuel/safety. Live-verified against the seed data: correctly showed the one real absent student as an attention item (no delayed or near-capacity buses existed in the current seed state, so none were fabricated to fill the list).

Not built in this follow-up (explicitly deferred, not silently dropped): a fully separate Student Management screen beyond the existing Attendance Matrix (judged not to add real capability beyond what the table + new bus drawer's "عرض الطلاب" already cover), a dedicated Seat Management view (unchanged from the prior pass's documented deferral), and a global cross-entity search beyond the Students tab's existing name/bus/grade/driver search.

Regression after this follow-up: 930/930 tests passing, clean `tsc --noEmit`, clean production build, live-verified in-browser with zero console errors on a fresh (non-HMR) page load.
