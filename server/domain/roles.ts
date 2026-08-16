// Single source of truth for "who can touch operational governance features"
// (Approval Center, Simulation Center, Operations Feed controls). Shared so
// agentRoutes.ts / simulationRoutes.ts never re-declare their own role list.
export const OPERATIONAL_ROLES = new Set(['admin', 'school']);
