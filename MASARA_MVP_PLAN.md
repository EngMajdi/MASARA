# MASARA AI — MVP Engineering Plan

Status: DRAFT FOR REVIEW — no implementation has started.
Scope: Pilot MVP for 1 school, 2–3 buses, ~30–60 students, per the master spec.

---

## 1. Current Architecture (as found)

The repository is **not empty** — it's a working AI Studio prototype called "مَسارَا MASARA"
(Arabic RTL, Gemini-powered). It's a solid foundation, not a blank slate.

**Stack**
- Vite 6 + React 19 + TypeScript, TailwindCSS 4, RTL Arabic UI (Tajawal font)
- Single Express server (`server.ts`) serving the API **and** the Vite dev/prod bundle from one process
- `leaflet` + `@types/leaflet` already installed (map library — currently used with mock tile rendering)
- `@google/genai` (Gemini) already wired up, with graceful fallback when no API key is set
- `recharts` already installed (for analytics charts)
- Package manager: **npm** (bun.lock exists but `bun` isn't installed on this machine — will use npm)
- No test framework configured yet
- No `.git` inside the project folder — see Risk R1 below (now resolved, see §7)

**Data layer**
- 100% **in-memory**, defined in `src/mockData.ts` (376 lines) and mutated directly inside `server.ts`
- Resets on every server restart. No persistence, no migrations, no real schema.
- Frontend polls `GET /api/all-data` every 2.5s for "realtime sync" (not WebSockets)

**Domain model today** (`src/types.ts`)
- `School`, `Bus`, `Student`, `Route` (+ `PickupStop`), `SystemNotification`, `AIAgentWorkflowStep`
- No `Trip`, `Incident`, `Prediction`, `Recommendation`, `Action`, `Verification`, or `AuditLog` entities exist yet
- `UserRole = 'parent' | 'driver' | 'school' | 'admin'` — a **parent portal already exists** (not in the new spec's role list, but functional and should not be deleted)

**Existing AI integration** (`server.ts`)
- `getGeminiClient()` — lazy init, returns `null` if `GEMINI_API_KEY` is unset → app already has a "no API key" fallback pattern, just not formalized as a `MockProvider`
- 4 AI endpoints today: `/api/ai/optimize-routes`, `/api/ai/detect-reroute`, `/api/ai/predict-traffic-eta`, `/api/ai/ask-advisor`, `/api/ai/run-agent`
- **Critical gap vs. spec §29 (safety rule):** these endpoints currently let the LLM (or its fallback) **directly mutate live state** (`routes`, `buses`, `students`) with no structured recommendation object, no human approval step, and no audit trail. This is the single biggest architectural change the MVP requires.

**Existing components** (`src/components/`, ~5,600 lines total)
- `Header`, `MapView` (Leaflet), `ParentPortal`, `DriverPortal`, `SchoolDashboard`, `AdminAIAgentPortal`, `AuthModal`, `NotificationsModal`, `AdvisorModal`, `DataManagementModal`, `SwipeableCard`
- `AdminAIAgentPortal.tsx` (1,198 lines) already renders an "AI workflow steps" timeline and recommendation text — reusable scaffolding for the new AI Operations page (§20) and Recommendations page (§14), but needs to be rebuilt around structured data + approve/reject instead of narrative text.

**Verdict:** Reuse the stack and ~70% of the UI shell (auth, header, map, notifications, driver boarding UI). Rebuild the data layer, the AI reasoning layer, and add the missing entities (Trip, Incident, Prediction, Recommendation, Action, Verification, AuditLog) and the human-approval loop. This is an **extension + refactor**, not a rewrite.

---

## 2. Decisions Locked In (from user)

| Decision | Choice |
|---|---|
| Git | Initialize a **new repo scoped to this project folder only**. The pre-existing repo at `C:\Users\squma\.git` (which tracks the whole home directory) is left untouched and unused. |
| Database | **SQLite via Drizzle ORM** for the MVP, schema written in Postgres-compatible style (UUID-as-text, explicit timestamps, enum-as-text-with-check). Zero external setup required. Swapping the Drizzle driver to `postgres-js`/Supabase later is a config change, not a schema rewrite. |

**Role mapping assumption** (stated here, not blocking — flag if wrong): the spec's three roles map onto the existing role system as `admin` → Transport Admin, `driver` → Driver, `school` → School Operator. The existing `parent` role/portal is **kept as-is** (out of spec scope, but functional — not deleted per the "don't destroy working code" rule).

**AI provider assumption:** build the `LLMProvider` abstraction with `MockProvider` (deterministic) and `GeminiProvider` (wraps existing Gemini code) as the two real implementations for the MVP. `OpenAIProvider` gets a stub class satisfying the interface but is not wired to a real key unless requested — spec only requires the app to *work* without any key, which Mock mode satisfies.

---

## 3. Proposed Architecture

```
src/
  components/          # existing UI kept; new components added for Trips, Incidents, Recommendations, Simulation, Analytics, AI Ops
  pages/                # new — one file per route in §19
  hooks/                # new — useDashboard, useTrip, usePolling, etc.
  services/             # new — thin fetch wrappers per resource
  lib/
  types/                # extend types.ts (or split) with new entities

server/
  routes/               # split server.ts into route modules (dashboard, trips, buses, students, incidents, recommendations, simulation, analytics, auth)
  engines/
    PredictionEngine.ts     # ETA / delay / risk calc — deterministic, swappable
    RouteEngine.ts          # route alternatives + ETA comparison
  agents/
    MasaraOperationsAgent.ts # orchestrator: detect → predict → recommend → wait for approval → execute → verify → log
    llm/
      LLMProvider.ts         # interface
      MockProvider.ts
      GeminiProvider.ts      # wraps existing @google/genai usage
      OpenAIProvider.ts      # stub, same interface
  services/
    ActionExecutor.ts       # the ONLY thing allowed to mutate trip/route state from an AI-originated action
    PolicyEngine.ts          # validates a recommendation before it's allowed to reach a human for approval
  repositories/              # DB access, one per entity, swappable SQLite→Postgres
  simulation/
    scenarios/                # NORMAL_TRIP, TRAFFIC_DELAY, ROUTE_BLOCKED, BUS_BREAKDOWN, STUDENT_NOT_BOARDED, STUDENT_NOT_DROPPED, MAJOR_DELAY

database/
  schema.ts             # Drizzle schema (Postgres-style, SQLite dialect)
  migrations/            # Drizzle-generated
  seed/                  # seed.ts — MASARA Pilot School, 3 buses, 3 drivers, ~40 students, 3 routes

tests/
  engines/               # PredictionEngine, RouteEngine unit tests
  agents/                 # approval/rejection/verification flow tests
```

`server.ts` becomes a thin bootstrap that mounts `server/routes/*`. The critical enforced flow (spec §29):

```
LLM → Structured Recommendation → PolicyEngine (validation) → stored as
ai_recommendation (status: PENDING) → Human clicks Approve/Reject →
  Approve → ActionExecutor mutates DB → VerificationService checks result → AuditLog
  Reject  → stored as rejected, DB untouched → AuditLog
```

The LLM **never** touches the database directly. Only `ActionExecutor` does, and only after human approval.

---

## 4. Database Schema (Drizzle, SQLite now / Postgres-ready)

All tables use `id text primary key` (UUID string), `created_at`/`updated_at` timestamps.

- **schools** — id, name_ar, name_en, lat, lng, address, start_time, end_time
- **users** — id, school_id, name, email, password_hash, role (`admin`|`driver`|`operator`|`parent`)
- **drivers** — id, user_id, name, phone, license_no
- **buses** — id, school_id, bus_number, plate_number, driver_id, capacity, status (`idle`|`en_route_pickup`|`en_route_school`|`returning`|`maintenance`), current_lat, current_lng, speed_kmh, fuel_level, safety_score
- **students** — id, school_id, name, grade, bus_id, pickup_lat, pickup_lng, pickup_address, seat_number, parent_name, parent_phone *(synthetic data only — no real children's data)*
- **routes** — id, school_id, name, waypoints (json), total_distance_km, estimated_duration_mins
- **route_stops** — id, route_id, name, lat, lng, order_sequence, student_ids (json)
- **trips** — id, route_id, bus_id, driver_id, status (`scheduled`|`active`|`completed`|`cancelled`), started_at, target_arrival_at, current_eta_at, completed_at
- **boarding_events** — id, trip_id, student_id, bus_id, event_type (`boarded`|`dropped_off`|`absent`), timestamp
- **incidents** — id, trip_id, bus_id, type (`TRAFFIC`|`BREAKDOWN`|`ACCIDENT`|`STUDENT_DELAY`|`ROUTE_BLOCKED`|`VEHICLE_ISSUE`|`OTHER`), severity (`low`|`medium`|`high`), description, status (`open`|`resolved`), timestamp
- **predictions** — id, trip_id, current_eta_at, target_arrival_at, predicted_delay_mins, delay_probability, risk_level (`low`|`medium`|`high`), created_by (`engine`|`agent_run_id`)
- **ai_recommendations** — id, trip_id, agent_run_id, severity, problem, prediction_id, action (`CHANGE_ROUTE`|`NOTIFY_PARENTS`|`DISPATCH_BACKUP`|...), target, expected_improvement_mins, reasoning, requires_approval (bool), status (`pending`|`approved`|`rejected`), decided_by_user_id, decided_at, rejection_reason
- **actions** — id, recommendation_id, action_type, payload (json), executed_at, executed_by_user_id
- **action_verifications** — id, action_id, eta_before, eta_after, improvement_mins, status (`success`|`failed`|`partial`), checked_at
- **notifications** — id, school_id, title, message, type, target_role, read, created_at
- **audit_logs** — id, agent_run_id, input_summary, detected_problem, prediction_id, recommendation_id, operator_decision, action_id, verification_id, created_at

Relationships are enforced via foreign keys; Drizzle migrations generated from `database/schema.ts`.

---

## 5. API Plan

Matches spec §24, extended with the trip/incident/recommendation/simulation resources needed for §35's end-to-end flow:

```
GET  /api/dashboard
GET  /api/buses               GET /api/buses/:id
GET  /api/trips                GET /api/trips/:id
POST /api/trips/:id/start
POST /api/trips/:id/board      { studentId }
POST /api/trips/:id/dropoff    { studentId }
POST /api/incidents            { tripId, type, severity, description }
GET  /api/recommendations
POST /api/recommendations/:id/approve
POST /api/recommendations/:id/reject   { reason? }
POST /api/simulation/trigger   { scenario }
POST /api/simulation/reset
GET  /api/analytics
GET  /api/audit-logs
```

Existing endpoints (`/api/auth/*`, `/api/students`, `/api/notifications`, etc.) are kept and migrated to read/write the new repositories instead of in-memory arrays.

---

## 6. Implementation Phases (run → test → fix after each)

1. **Foundation** — scoped git repo, Drizzle schema + migrations, seed data (MASARA Pilot School, 3 buses, 3 drivers, ~40 students, 3 routes), repository layer, server route-module split. Existing auth/portals still work against the new DB.
2. **Dashboard** — KPI cards, bus cards, alerts, wired to real DB via `/api/dashboard`.
3. **Trips** — `Trip` entity replacing the implicit route/bus coupling; trip detail page; simulated GPS movement tick; boarding events; incident reporting from Driver Portal.
4. **Prediction Engine** — deterministic ETA/delay/probability/risk calculator behind a swappable interface; `predictions` persisted.
5. **Route Engine** — alternative-route generation + ETA comparison, structured JSON output, independent of the AI reasoning layer.
6. **MASARA Operations Agent** — orchestration (detect → predict → route options → recommend → explain), `LLMProvider` abstraction with Mock/Gemini implementations, structured recommendation schema, `PolicyEngine` validation.
7. **Human-in-the-loop** — Recommendations page with Approve/Reject, `ActionExecutor`, `VerificationService`, `audit_logs`. This closes the loop from spec §29.
8. **Simulation Engine** — 7 scenarios, control panel, wired to actually mutate trip/bus/incident state and trigger the Agent.
9. **Demo Mode** — scripted end-to-end run of the full §35 flow, auto-advancing with visible pacing for a live pitch.

Analytics page (§21, clearly labeled `SIMULATION` where values are synthetic) and remaining pages (§19) are built alongside the phase that produces their data (e.g., Incidents page in Phase 3, AI Operations activity log in Phase 6).

---

## 7. AI Agent Design

- `LLMProvider` interface: `generate(prompt, schema): Promise<StructuredResult>`
- `MockProvider`: deterministic rule-based responses (reuses/formalizes the existing fallback logic already in `server.ts`) — guarantees the full loop demos with zero API key.
- `GeminiProvider`: wraps existing `@google/genai` calls, same fallback-on-error behavior already implemented.
- `MasaraOperationsAgent.run(tripId)`:
  1. inspect trip/bus/prediction state
  2. detect anomaly (delay risk, incident, missing boarding event)
  3. call `PredictionEngine` for delay/probability/risk
  4. call `RouteEngine` for alternatives
  5. call `LLMProvider` to produce reasoning + structured recommendation (schema per spec §13)
  6. `PolicyEngine` validates (e.g., reject recommendations with implausible values)
  7. persist as `ai_recommendations` (status `pending`) + `audit_logs` entry
  8. **stop** — wait for a human decision via the API
- On approve: `ActionExecutor` applies the change (e.g., update trip's active route), `VerificationService` re-checks ETA and records `action_verifications`, audit log updated.
- On reject: recommendation marked rejected with operator/timestamp/reason, no DB mutation beyond that record, audit log updated.
- AI Operations page (§20) streams the audit log for a given agent run as a timestamped activity feed — reuses the visual pattern already in `AdminAIAgentPortal.tsx`.

---

## 8. Simulation Engine Design

Each scenario is a function that mutates trip/bus/incident state in a controlled way and then invokes the Agent:

- `NORMAL_TRIP` — baseline, no anomalies
- `TRAFFIC_DELAY` — inflates predicted ETA past target → triggers delay prediction
- `ROUTE_BLOCKED` — marks current route stop unreachable → forces route-alternative path
- `BUS_BREAKDOWN` — sets bus status to maintenance mid-trip → forces backup/incident path
- `STUDENT_NOT_BOARDED` / `STUDENT_NOT_DROPPED` — missing boarding event at expected time → safety alert path (spec §28 "Safety" test case)
- `MAJOR_DELAY` — compounds traffic + incident for the full demo story

Control panel buttons call `POST /api/simulation/trigger { scenario }`; `POST /api/simulation/reset` restores seeded baseline state. Demo Mode (§23) chains scenarios with timed pacing to narrate the full spec §35 flow automatically.

---

## 9. Testing Plan

Using **Vitest** (not yet installed — will be added).

- `PredictionEngine`: ETA > target ⇒ delay detected; large predicted delay ⇒ HIGH risk
- `RouteEngine`: faster alternative ⇒ recommendation generated with correct `improvementMinutes`
- `MasaraOperationsAgent` + approval flow: approve ⇒ `ActionExecutor` called, DB mutated; reject ⇒ DB untouched, rejection recorded
- `VerificationService`: new ETA < previous ETA ⇒ `SUCCESS`; otherwise `FAILED`/`PARTIAL`
- Safety: trip completed with incomplete student boarding status ⇒ alert generated
- `MockProvider`: full agent loop runs and produces a valid structured recommendation with zero API key configured

---

## 10. Risks & Assumptions

- **R1 (resolved):** project had no scoped git repo; a new one will be initialized in this folder only.
- **R2:** No Postgres/Supabase instance available on this machine — proceeding with SQLite+Drizzle per the locked-in decision; migration path documented but not executed in this MVP.
- **R3:** `bun.lock` exists but `bun` isn't installed here — will use `npm` consistently and can regenerate a `package-lock.json`; `bun.lock` left in place but unused.
- **R4:** Existing AI endpoints currently mutate state directly (no approval gate) — these will be **replaced**, not just extended, to satisfy spec §29. This is the largest single refactor in the plan.
- **R5:** No real GPS/traffic data source — all movement, traffic, and delay figures are simulated by design (per spec §3, §9, §22); UI must label simulated analytics values as `SIMULATION` per spec §21.
- **R6:** Existing `parent` role/portal is out of the new spec's scope; kept functional but not extended with new features unless requested.
- **A1:** Synthetic seed data only — no real student PII, per spec §7/§17.
- **A2:** Single-school pilot scope (per spec §3) — multi-school support is explicitly out of scope for this MVP.

---

## Next Step

Once this plan is reviewed, implementation proceeds phase-by-phase per §6, running and testing after each phase before moving to the next.
