import { useEffect, useRef, useState } from 'react';
import { getGovernedBus } from './approvalsApi';

/**
 * Resolves a governed bus UUID (as returned by the telemetry/ETA endpoints)
 * to its `busNumber` string (e.g. "حافلة 101") — the one field confirmed to
 * match the legacy `Bus.busNumber` exactly (see
 * docs/LIVE_TRACKING_ARCHITECTURE_AUDIT.md and the transformation report's
 * P0-2 section). This is the SAME dual-identity-store problem already
 * documented for students, now affecting bus telemetry/ETA display: the
 * governed and legacy bus records share no common ID, only this one
 * matching display field. Results are cached for the component's lifetime
 * so repeated polls don't re-fetch a bus we've already resolved.
 */
export function useGovernedBusNumbers(governedBusIds: string[], sessionToken: string | undefined) {
  const [map, setMap] = useState<Record<string, string>>({});
  const cacheRef = useRef<Record<string, string>>({});
  const pendingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!sessionToken) return;
    const missing = governedBusIds.filter((id) => id && !cacheRef.current[id] && !pendingRef.current.has(id));
    if (missing.length === 0) return;

    missing.forEach((id) => pendingRef.current.add(id));
    Promise.all(
      missing.map((id) =>
        getGovernedBus(id, sessionToken)
          .then((bus) => {
            cacheRef.current[id] = bus.busNumber;
          })
          .catch(() => {
            // Leave unresolved — the caller falls back to a truncated id, never a guess.
          })
          .finally(() => pendingRef.current.delete(id))
      )
    ).then(() => setMap({ ...cacheRef.current }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [governedBusIds.join(','), sessionToken]);

  return map;
}
