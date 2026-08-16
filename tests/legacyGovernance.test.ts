import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// server.ts self-starts an Express listener as an import side effect, so it
// can't be safely `import`-ed from a test process (it would bind a real
// port). This is a source-level regression guard instead: it proves the
// specific direct-mutation code patterns Phase 2B was asked to remove are
// actually gone from each legacy AI handler, scoped to that handler's body
// only (not the whole file). Complemented by live curl verification during
// the Phase 2B browser QA pass — see the final report.

const serverSource = fs.readFileSync(path.resolve(__dirname, '../server.ts'), 'utf8');

function extractHandler(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Marker not found in server.ts: ${marker}`);
  const afterMarker = source.slice(start + marker.length);
  const nextRouteMatch = afterMarker.match(/\napp\.(get|post|delete|put)\(/);
  const end = nextRouteMatch ? start + marker.length + nextRouteMatch.index! : source.length;
  return source.slice(start, end);
}

describe('Legacy AI endpoints no longer mutate operational state directly (spec Phase 2B §29-32, AC-15/16)', () => {
  it('/api/ai/optimize-routes no longer reassigns the routes array from AI output', () => {
    const handler = extractHandler(serverSource, "app.post('/api/ai/optimize-routes'");
    expect(handler).not.toMatch(/routes\s*=\s*routes\.map/);
  });

  it('/api/ai/detect-reroute no longer writes nextStopEtaMins/status onto a bus from AI output', () => {
    const handler = extractHandler(serverSource, "app.post('/api/ai/detect-reroute'");
    expect(handler).not.toMatch(/targetBus\.(nextStopEtaMins|status)\s*=/);
  });

  it('/api/ai/predict-traffic-eta no longer writes predicted ETAs onto buses from AI output', () => {
    const handler = extractHandler(serverSource, "app.post('/api/ai/predict-traffic-eta'");
    expect(handler).not.toMatch(/matchBus\.nextStopEtaMins\s*=/);
  });

  it('the governed API (agentRoutes.ts) is the only path that imports ActionExecutor', () => {
    const agentRoutesSource = fs.readFileSync(
      path.resolve(__dirname, '../server/routes/agentRoutes.ts'),
      'utf8'
    );
    expect(agentRoutesSource).toMatch(/from ['"].*ActionExecutor['"]/);
    // server.ts's legacy AI endpoints must never import it directly — note
    // this checks for an actual import statement, not just the word, since
    // this file's governance-fix comments legitimately *mention*
    // ActionExecutor in prose while explaining what NOT to do.
    expect(serverSource).not.toMatch(/from ['"].*ActionExecutor['"]/);
    expect(serverSource).not.toMatch(/require\(['"].*ActionExecutor['"]\)/);
  });
});
