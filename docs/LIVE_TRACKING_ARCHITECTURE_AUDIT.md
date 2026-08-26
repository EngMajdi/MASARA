# MASARA — Live Tracking Architecture Audit

Required by Phase 9 (Live Tracking, School Operations & AI Distribution Extension) before any live-tracking UI work: "Do NOT assume that a changing frontend value is genuine GPS telemetry." This document records what was actually inspected in the running codebase — not an assumption — and what may safely be presented as "live."

---

## 1. Two independent systems exist. Only one is real telemetry.

MASARA has two completely separate data models for "where is the bus":

### 1a. Legacy `Bus` record (`legacy_buses` table / `Bus` type)
Fields: `currentLocation: {lat, lng}`, `speedKmH`, `nextStopEtaMins`, `nextStopName`, `status`.

**Finding: these are static operational snapshot fields.** Grepping `server.ts` and every `server/services/*.ts` file for writes to these fields found exactly zero server-side code that updates `currentLocation`, `speedKmH`, or `nextStopEtaMins` after seed time — they are set once in `database/seed/seed.ts` and never change on their own. The only thing that ever moved a bus icon on screen was `MapView.tsx`'s own `setInterval` client-side linear-interpolation of a hardcoded target coordinate — **a purely cosmetic animation with no data behind it, that never wrote back to the server.** This is exactly the kind of fabricated movement §25/§8 of the Phase 9 spec forbids. It has been removed from anything that claims to be "live" in this pass (see §6).

`nextStopEtaMins` is likewise a static seeded number — it does not count down in real time. It remains useful as a rough, clearly-non-live operational figure (e.g., "on the roster since this morning"), but is never labeled "Live" going forward.

### 1b. Governed telemetry pipeline (Phase 4A–4E, unchanged by this pass)
A real, three-stage system:

1. **Ingestion** — `POST /api/telemetry/observations` writes one real observation row to `telemetry_observations`, authenticated as a device (`requireTelemetryDevice`). History is queryable via `GET /api/telemetry/observations` (filterable by bus/trip/time range) — **real historical data exists once observations exist.**
2. **Current Location Projection** (`CurrentLocationProjectionService`) — server-derived "what is the latest known location," never a raw scan, exposed via `GET /api/telemetry/current/:busId` and `/fleet`. Every response carries a `freshness: 'FRESH' | 'STALE'` flag computed server-side — **this is a real, honest freshness guarantee**, not a UI-invented label.
3. **ETA Intelligence** (`EtaService`, Phase 4D) — computed from the current-location projection + route geometry, exposed via `GET /api/eta/bus/:busId`, `/trip/:tripId`, `/fleet`. Carries a real `status` (`ON_TIME | DELAYED | STALE | UNKNOWN`), `confidence` (`HIGH | MEDIUM | LOW`), `source` (`TELEMETRY | SIMULATION`), and a human `explanation` object (`freshLocation`, `validSpeed`, `routeGeometryAvailable`). **Confidence is a real server-computed value, never a UI-fabricated percentage.**

**This is the only system honest enough to ever be labeled "Live" in the UI, and this pass uses it exclusively for that purpose.**

### 1c. Where does telemetry data actually come from?

There is no real GPS device connected to this deployment. The only producer of telemetry observations is the admin/school-gated **GPS Simulation Engine** (`server/services/GpsSimulationEngine.ts`, Phase 4A), already disclosed in its own UI copy: *"محاكاة رصد GPS — رصدات موقع محاكاة (SIMULATION) فقط، لا اتصال بجهاز حقيقي"* ("GPS observation simulation — SIMULATED readings only, no real device connection"). Once an operator starts a session, `GpsSimulationPanel.tsx` auto-advances it every 1.2s client-side (a demo refresh cadence, not the simulated clock itself) via real `POST /api/gps-simulation/:id/advance` calls, and each advance genuinely writes a real observation that flows through the full real pipeline above (`source: 'SIMULATION'`, honestly labeled as such in every response).

**Practical consequence: for any given bus, "Live" data will only exist if an admin/school operator has started (and not stopped) a GPS Simulation session for that bus's trip.** Outside of that, `GET /api/telemetry/current/:busId` correctly 404s with *"لا يوجد موقع حالي معروف لهذه الحافلة بعد"* — this is the expected, honest, common case in this pilot, not a bug. This pass's UI must (and does) render that as a calm, clear empty state, never as a stalled spinner or, worse, a silently-substituted fake position.

---

## 2. Trip / journey lifecycle — what's real, what's static

### 2a. Per-student Journey state (Phase 3B, `JourneyStateMachine`) — real, live, user-driven
`scheduled → waiting → boarding → on_bus → in_transit → approaching_stop → dropped_off → completed` (+ `missed`/`cancelled`/`incident`). Every transition is a named, authorized, server-validated endpoint (`POST /api/journeys/:id/start`, `/board`, `/start-transit`, `/approach-stop`, `/drop-off`, `/complete`, …) — driven by real driver actions in `DriverJourneyConsole`. **This is the one genuinely real, live, per-child lifecycle in MASARA**, and it maps directly onto the Phase 9 spec's requested lifecycle without inventing anything:

| Spec's conceptual stage | Real MASARA `JourneyState` |
|---|---|
| Not Started | `scheduled` |
| Trip Started | `waiting` / `boarding` |
| Live / In Progress | `on_bus` / `in_transit` |
| Approaching Destination | `approaching_stop` |
| Arrived | `dropped_off` |
| Completed | `completed` |

`ParentJourneyView.journey.state` (from the existing, already-authorized `GET /api/parent/journeys`) already exposes exactly this — **no backend change needed for the Parent-facing lifecycle.**

### 2b. Trip-level status (`trips.status`: `scheduled | active | completed | cancelled`) — **static, not a real live transition**

**BACKEND CHANGE REQUIRED (documented, not silently worked around):** grepping every `server/services/*.ts` for a write to `trips.status` found none — it is set once at seed time and never mutated by any user action. There is no `POST /api/trips/:id/start` endpoint. The legacy "Start Route" button on the Driver Portal (`/api/buses/:id/start-route`) only touches `legacy_buses.status` — a completely different table with no relationship to `trips.status`.

**What this pass does instead:** rather than displaying the inert `trips.status` as if it were a live "trip started" signal (which would be dishonest — it never changes), any trip-level "in progress" indicator in this pass is honestly derived from the real, live, per-student Journey states of that trip (e.g., "at least one journey has left `scheduled`"). This is accurate today. A real trip-level lifecycle (if the product wants one distinct from the per-student view) needs a new `POST /api/trips/:id/start` (and `/complete`) endpoint — flagged here as the concrete backend requirement, not built in this pass.

---

## 3. Update mechanism: polling, not push

There is no WebSocket, Server-Sent Events, or Firebase realtime listener anywhere in this codebase (confirmed by searching for `WebSocket`, `EventSource`, `firebase`, `socket.io` — none found outside the app's own dev-server HMR websocket, which is unrelated). Every "live" surface in MASARA — `CurrentLocationPanel`, `EtaPanel`, `ParentJourneyPanel`'s predecessor, `DriverJourneyConsole`, the main `App.tsx` sync loop — uses a plain `setInterval` + `fetch` polling loop, typically every 4–7 seconds. This pass's new live-tracking UI follows the same, already-established pattern (no new realtime infrastructure introduced, consistent with §24's own instruction not to assume push infrastructure exists).

---

## 4. Route geometry for map rendering

`GovernedRoute` (governed) exposes only summary fields (`totalDistanceKm`, `estimatedDurationMins`, `status`) — no waypoint geometry. `GovernedRouteStop` (governed, via `GET /api/routes/:routeId/stops`, already used by `DriverJourneyConsole`) gives real ordered stop coordinates. The **legacy** `Route.waypoints` array (used by the old `MapView`) is a static, hand-authored path shape — useful for drawing "the planned route" on a map, but it is not live-computed and is never presented as tracked history.

**Decision for this pass:** the map shows the real current bus marker (from the telemetry projection, when it exists) plus real stop markers (from `GovernedRouteStop`) plus the static planned route line (legacy waypoints, explicitly framed as "planned route," never as "traveled path"). A precise "% of route completed" polyline split was **not** attempted — the honest, real quantity available for that purpose is `EtaEstimateView.remainingToDestinationMeters` vs. the route's total distance, which this pass uses for a simple linear progress indicator, not a geometrically precise map overlay.

**Not built, but genuinely possible with real data:** `GET /api/telemetry/observations` already returns real historical points once a GPS Simulation session has produced several — a "traveled path" polyline from genuine history is a real, honest feature that could be added later; it was out of scope for this pass's time budget, not fabricated as done.

---

## 5. Authorization — server-side, unchanged, and confirmed sufficient

Every telemetry/ETA/journey read this pass relies on was already governed by an existing, tested server-side guard in `server/services/authz.ts` — nothing new was added or loosened:

| Guard | Admin/School | Driver | Parent |
|---|---|---|---|
| `requireTelemetryReader` (location) | full fleet | own bus/trip only | **excluded — 403** |
| `requireJourneyReader` (journey state) | full | own trip only | **excluded — 403** |
| ETA routes | full fleet | own bus/trip only | **excluded — 403** |
| `requireParentUser` (`/api/parent/journeys`) | n/a | n/a | **own children only**, server-resolved from session email |

**Consequence for this pass's design:** a parent's UI never calls `/api/telemetry/*` or `/api/eta/*` directly (it would correctly 403). All parent-facing live data is sourced exclusively from the already-authorized, parent-safe `GET /api/parent/journeys`, which already bundles `location` + `eta` + `driver.displayName` in one server-derived, ownership-checked response. This is not a new endpoint — it already existed and already returns everything the Phase 9 "Parent Live Journey" experience needs.

---

## 6. What this pass changed, concretely

- **Removed**: `MapView.tsx`'s fake client-side bus-position interpolation (`setInterval` + linear interpolation toward a hardcoded target) and its play/pause "مباشر 🟢" control that implied real motion. This was cosmetic and never backed by data.
- **Added**: a shared `LiveRadar` presentational component that renders whatever real position/freshness/ETA data it is given — an honest empty state when there is none, a stale badge when the server says `STALE`, and only says "Live" when the server says `FRESH`.
- **Data flow, per role**: Parent ← `getParentJourneys()` (existing, parent-safe). Driver ← `getBusCurrentLocation`/`getBusEta` scoped to their own bus (existing, driver-scoped). School/Admin ← `getFleetCurrentLocations`/`getFleetEta` (existing, operational-role-scoped).
- **No new backend code was written for this pass.** Every data source used already existed, was already authorized correctly, and was already real — the work here is presenting it honestly and usefully, not building new telemetry infrastructure.

---

## 7. Summary of backend requirements (not built, documented per §7/§35)

1. **`POST /api/trips/:id/start` (and a completion equivalent)** — if a genuine trip-level (not just per-student) lifecycle signal is wanted, distinct from the currently-inert `trips.status`.
2. **A student bus-reassignment endpoint** (e.g., `PATCH /api/students/:id/assign-bus`) — does not exist today. This directly limits the AI Distribution Assistant (§17–19 of the spec) to advisory-only with no "Approve → apply" action; see the Distribution Assistant section of the main transformation report for how this was handled honestly.
3. **A real device/GPS provider integration** — was already flagged in Phase 7F ("Real Email Provider Integration Audit" precedent) as future work; unchanged by this pass. Everything "live" in this pilot is fed by the operator-triggered GPS Simulation Engine, clearly labeled as such.
