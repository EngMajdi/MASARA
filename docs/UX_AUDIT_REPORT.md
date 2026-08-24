# MASARA — Customer Experience Audit Report

**Method:** live login and interaction as each of the four real roles (parent, driver, school, admin) against the running application — not a code-only review. Every finding below was actually reproduced, either through the live UI or through direct source inspection of the component that produces it. Where a finding was almost-real but turned out to be a testing artifact (see §0), that is disclosed explicitly rather than hidden.

**Baseline recorded before any change:** commit `5c9f6dc`, 930/930 tests passing, typecheck clean.

---

## 0. A methodology note, disclosed honestly

During the live walkthrough I initially flagged two findings that turned out to be false positives from my own test methodology (rapid `localStorage.setItem` + `location.reload()` calls sometimes read the DOM before the reload finished navigating, briefly showing the previous role's stale content). I re-verified both properly:
- "Driver briefly shows 'no bus assigned'" — was a stale read. Not real.
- "Logged in as school, saw the driver portal" — was a stale read. Not real.

Both are recorded here so the reasoning is auditable, not because they're real defects. The findings below are the ones that reproduced on a clean, explicit navigation.

---

## 1. Product strengths (confirmed real, not assumed)

- The security/ownership work already in place is genuinely solid and was not touched: driver-bus and parent-student ownership enforce correctly server-side, disabled accounts can't log in, session revocation is immediate, role escalation is closed.
- The AI governance boundary is real, not decorative: the parent-facing notification feed already shows a route-optimization result as "advisory only, not automatically applied to routes" — an honest, non-fabricated framing that most prototypes get wrong.
- Several empty/stale-data states are already handled honestly where they exist: "لا يوجد موقع حالي معروف لهذه الحافلة بعد" (no known bus location yet) and "الثقة: منخفضة" (confidence: low) for ETA — this is exactly the kind of "never pretend data is live if it's stale" discipline the brief asks for, and it already exists in `CurrentLocationPanel`/`EtaPanel`.
- The forced-password-change and employee-management flows built this session are already close to the "zero training" bar — the one-time credential reveal is clear and the confirmation dialogs are simple.
- Absence reporting, boarding confirmation, and driver route-start all work end-to-end with real confirmation dialogs, not silent actions.

## 2. Major UX problems (evidence-based, prioritized)

### P0 — Safety-critical

**P0-1. A driver cannot reliably tell two students apart in the Journey Console when their generated names look identical.**
Live-reproduced: driver1's Journey Console for a 10-student trip rendered what looked like 20 rows. On inspection this is not a rendering bug — it's that the demo data generator (`database/seed/seed.ts`'s `studentName(i)`) only draws from 20 first names for a 40-student roster, so two *different, real* students can have the exact same displayed name, distinguished only by a small grade label under the name. In a real deployment with common Arabic names, this is a realistic collision, not just a demo artifact. A driver in a hurry could confirm boarding for the wrong child. This is exactly the class of error the brief calls out as unacceptable ("would I trust my child to this?").
*File: `src/components/DriverJourneyConsole.tsx` — each student card (line ~322-369) shows only name + grade, no seat number or other disambiguator.*

**P0-2. The parent's two data sources (legacy vs. governed) can show materially different "my children" lists on the same screen, with no explanation.**
Live-reproduced: the "Live Journey" panel at the top of ParentPortal (governed data) and the "متابعة أبنائي" section below it (legacy data) are two independent identity stores that were never reconciled (documented since Phase 5A/7I/7K). In the current demo data they happen to show overlapping-but-not-identical names. A real parent seeing two different lists of "their children" on the same screen, with no label explaining why, would reasonably conclude the system is broken or looking at someone else's data. This is a trust-destroying pattern for a product whose entire value proposition is "know your child is safe."

### P1 — Major usability/trust problems

**P1-1. The parent's first screen does not answer the "5-second test."**
The first thing a parent sees is a large GPS radar map with filter controls, a legend, and a height-mode switcher — engineering-tool framing, not "is my child safe" framing. The actual status (child name, boarding state, bus, ETA) is present, but it's below the map, mixed in with map controls and a driver-contact card. There is no single glanceable "your child is fine" summary at the very top.

**P1-2. Duplicate/repeated notifications.**
Live-reproduced: the same "Bus 101 is 5 minutes away" alert appeared 2–4 times in the same session, timestamped minutes apart. Root cause: `ParentPortal.tsx`'s auto-notify dedup key (`firedStudentAlerts`) is component-state, not fact-state — every full page reload re-arms it. A parent who checks the app a few times before pickup will see the same "urgent" alert repeatedly, which either causes false alarm or (worse) trains them to ignore real alerts.

**P1-3. Operationally-irrelevant AI content leaks into the parent's personal alert feed.**
Live-reproduced: an admin's manually-triggered "AI route optimization saved 18% fuel" notice appeared in the *parent's* notification list. This is an operational/admin-facing event, not something a parent needs or can act on. It also directly violates the brief's own "AI must be invisible when not useful" principle — it's AI self-promotion, not a parent outcome.

**P1-4. The admin's default landing screen is a decorative AI architecture diagram, not a control room.**
Live-reproduced: `AdminAIAgentPortal`'s default view is a 5-stage "AI Workflow" diagram (Data Intake → Analysis → Routing Engine → Decision → Dispatch), all stages marked "نشط ⚡" (active) permanently, with jargon like "OD Matrix." There is no fleet summary, no delayed-bus count, no "what needs attention" — exactly the opposite of the §9/§10 control-room requirement. An administrator logging in for the first time learns nothing actionable; they learn that the product has an impressive-sounding architecture.

### P2 — Important improvements

**P2-2. Technical/internal terminology surfaces in a few user-facing labels** — "GPS Live Radar", "Journey Console", "Multi-Source Data Inputs" — harmless individually but collectively signal "engineering demo" rather than "calm, trustworthy product," which is exactly the tone the brief asks to avoid.

**P2-3. The legacy "Start Route" button and the governed "Journey Console" are both present on the driver screen simultaneously**, representing two overlapping "start the trip" concepts from two different backends. A first-time driver has no way to know these are different systems or which one matters.

### P3 — Polish

- Minor: the driver/parent portals briefly render against stale mock data (`INITIAL_BUSES`/`INITIAL_STUDENTS`, which have no real `driverId`/`parentId`) before the first real sync completes, which is what caused the false positives in §0. Not user-visible in practice (sync completes in well under a second on localhost) but worth a proper loading skeleton instead of relying on mock-data coincidence.

## 3. Customer journey scores (0–10, honest, not inflated)

| Journey | Score | Why |
|---|---|---|
| Parent | 5 | Core data is all present and mostly accurate, but the presentation actively works against the "peace of mind in 5 seconds" goal, and the duplicate/irrelevant notifications actively erode trust. |
| Driver | 6 | Clear primary actions and good confirmation dialogs; undermined by the name-collision safety risk and the two-parallel-systems confusion. |
| School | 7 | Already closest to a real control room (fleet radar + attendance matrix + KPIs on one screen) — not audited as deeply this pass, no major live-reproduced problems found. |
| Admin | 4 | Employee/ownership management (this session's own work) is genuinely usable; the *default* AI portal view is pure decoration with zero operational value. |
| Trust | 4 | The dual-identity-list problem and duplicate notifications are the two biggest trust risks found. |
| Clarity | 5 | Good moments (honest stale-data labels) undercut by jargon and buried status info. |

## 4. What this pass will fix vs. defer

Given the size of the full brief (full navigation IA rebuild, full design-system unification, full accessibility/contrast audit, full mobile-viewport audit) is a multi-week effort on its own, this pass focuses on the **highest safety/trust-impact, lowest-regression-risk** items, matching the brief's own stated priority order (safety-critical usability → parent trust → driver usability → school → admin → accessibility → mobile → ...):

**Implementing now:**
1. Parent: a glanceable status summary at the very top of the portal (child, status, bus, ETA) — before the map.
2. Fix the notification-duplication bug (fact-based dedup instead of session-based).
3. Stop admin/operational AI notices from appearing in the parent notification feed.
4. Driver: add the seat number to each student card in the Journey Console so two similarly-named students are always visually distinguishable.
5. Admin: add a real operational summary strip (active buses, delayed, attention-needed) above the AI architecture diagram, so the first thing an admin sees is status, not decoration.
6. A handful of the most visible microcopy fixes (map heading, journey console framing) where they're cheap and high-value.

**Explicitly deferred, recommended as a dedicated next phase (not fabricated as "done"):**
- Full information-architecture/navigation rebuild.
- Reconciling the legacy/governed dual-identity data model (this is a real architectural decision, not a UI fix — flagged per §32's own STOP instruction: it would require a backend/data-model decision about which identity store is authoritative, which is out of scope to decide unilaterally).
- Full accessibility contrast/keyboard-navigation audit (requires visual tooling this environment doesn't have reliable access to this session).
- Full mobile-viewport-by-viewport audit of every screen.
- Design-system component unification across all modals.
