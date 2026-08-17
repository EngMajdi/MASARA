// Single source of truth for "who can touch operational governance features"
// (Approval Center, Simulation Center, Operations Feed controls). Shared so
// agentRoutes.ts / simulationRoutes.ts never re-declare their own role list.
export const OPERATIONAL_ROLES = new Set(['admin', 'school']);

// Journey Core reads (spec Phase 3A §21/§49): drivers need to read journey
// data to know what to board/drop off, so the read scope is wider than the
// write-operational set above. Parent is deliberately excluded — Phase 3A
// gives parents no access at all yet; scoped read-only access is designed
// for later (spec §21) but not built now, so it's simplest and safest to
// exclude parent entirely rather than half-build unscoped access.
export const JOURNEY_READ_ROLES = new Set(['admin', 'school', 'driver']);
