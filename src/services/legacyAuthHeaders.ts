// Phase 7A — the one place the legacy session token becomes an
// Authorization header, reused at every call site that hits the newly
// protected legacy surface (server.ts, agentRoutes.ts GET reads).
export function legacyAuthHeaders(sessionToken?: string): Record<string, string> {
  return sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};
}
