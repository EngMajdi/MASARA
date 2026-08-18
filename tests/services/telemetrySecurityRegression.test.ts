import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Source-level regression guards (spec Phase 4B §70/§120/§121) — same
// pattern as tests/legacyGovernance.test.ts and the Phase 4A route-scan
// test: prove the forbidden shapes are structurally absent from the actual
// route source, not just "untested".

const telemetryRoutesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/telemetryRoutes.ts'), 'utf8');
const deviceRoutesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/deviceRoutes.ts'), 'utf8');
const journeyRoutesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/journeyRoutes.ts'), 'utf8');
const agentRoutesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/agentRoutes.ts'), 'utf8');
const operationsRoutesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/operationsRoutes.ts'), 'utf8');
const simulationRoutesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/simulationRoutes.ts'), 'utf8');
const gpsSimulationRoutesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/gpsSimulationRoutes.ts'), 'utf8');
const allRoutesSource =
  telemetryRoutesSource + deviceRoutesSource + journeyRoutesSource + agentRoutesSource + operationsRoutesSource + simulationRoutesSource + gpsSimulationRoutesSource;

describe('No generic event injection endpoint exists anywhere (spec §13/§70/§120 regression)', () => {
  it('no POST /api/events, /api/gps, or bare /api/telemetry endpoint exists', () => {
    expect(allRoutesSource).not.toMatch(/['"]\/api\/events['"]/);
    expect(allRoutesSource).not.toMatch(/['"]\/api\/gps['"]/);
    expect(allRoutesSource).not.toMatch(/post\(\s*['"]\/api\/telemetry['"]/);
  });

  it('the only telemetry ingestion route is the single, specific observations endpoint', () => {
    expect(telemetryRoutesSource).toMatch(/post\(\s*['"]\/api\/telemetry\/observations['"]/);
  });
});

describe('Protected fields are never trusted from the request body (spec §14/§67/§121)', () => {
  it('the ingestion route never reads req.body.receivedAt, req.body.source, or req.body.eventType', () => {
    expect(telemetryRoutesSource).not.toMatch(/req\.body\??\.receivedAt/);
    expect(telemetryRoutesSource).not.toMatch(/req\.body\??\.source\b/);
    expect(telemetryRoutesSource).not.toMatch(/req\.body\??\.eventType/);
  });
});

describe('Every device-management route requires an authorized human operator (spec §92)', () => {
  it('every deviceRouter handler calls requireOperationalUser', () => {
    const handlerCount = (deviceRoutesSource.match(/deviceRouter\.(get|post)\(/g) ?? []).length;
    const guardCount = (deviceRoutesSource.match(/requireOperationalUser\(/g) ?? []).length;
    expect(handlerCount).toBeGreaterThan(0);
    expect(guardCount).toBe(handlerCount);
  });
});

describe('Telemetry routes use the correct dedicated guards (spec §12/§82)', () => {
  it('the ingestion (POST) route authenticates via requireTelemetryDevice, not a human-user guard', () => {
    expect(telemetryRoutesSource).toMatch(/requireTelemetryDevice\(/);
    // Must not be gated by requireOperationalUser — a device is not a human user (spec §12).
    // Bounded to just this one handler (up to its closing "});"), not the rest of the file —
    // later Phase 4C routes legitimately use requireOperationalUser for the fleet endpoint.
    const start = telemetryRoutesSource.indexOf("telemetryRouter.post('/api/telemetry/observations'");
    const postBlock = telemetryRoutesSource.slice(start, telemetryRoutesSource.indexOf('});', start));
    expect(postBlock).not.toMatch(/requireOperationalUser\(/);
  });

  it('the read (GET) route authenticates via requireTelemetryReader', () => {
    expect(telemetryRoutesSource).toMatch(/requireTelemetryReader\(/);
  });
});

// Phase 4C — Current Location Projection guards.
const currentLocationServiceSource = fs.readFileSync(
  path.resolve(__dirname, '../../server/services/CurrentLocationProjectionService.ts'),
  'utf8'
);
const currentLocationRepoSource = fs.readFileSync(
  path.resolve(__dirname, '../../server/repositories/currentLocationProjectionRepository.ts'),
  'utf8'
);

describe('The projection is server-derived only — no write endpoint exists (spec §28, mandatory)', () => {
  it('no POST/PUT/PATCH/DELETE route targets /api/telemetry/current', () => {
    expect(telemetryRoutesSource).not.toMatch(/\.(post|put|patch|delete)\(\s*['"]\/api\/telemetry\/current/);
  });

  it('the fleet endpoint is gated by requireOperationalUser and the single-bus endpoint by requireTelemetryReader', () => {
    const fleetBlock = telemetryRoutesSource.slice(telemetryRoutesSource.indexOf("'/api/telemetry/current/fleet'"));
    expect(fleetBlock.slice(0, fleetBlock.indexOf('});'))).toMatch(/requireOperationalUser\(/);

    const singleBlock = telemetryRoutesSource.slice(telemetryRoutesSource.indexOf("'/api/telemetry/current/:busId'"));
    expect(singleBlock.slice(0, singleBlock.indexOf('});'))).toMatch(/requireTelemetryReader\(/);
  });

  it('the fleet route is registered before the :busId route (so "fleet" is never parsed as a busId)', () => {
    expect(telemetryRoutesSource.indexOf("'/api/telemetry/current/fleet'")).toBeLessThan(
      telemetryRoutesSource.indexOf("'/api/telemetry/current/:busId'")
    );
  });
});

describe('Projection logic never imports Journey/AI/governance code (spec §27/§49, architectural guardrail)', () => {
  const forbidden = /from ['"].*\/(JourneyService|JourneyStateMachine|ActionExecutor|PolicyEngine|MasaraOperationsAgent|PredictionEngine)['"]/;

  it('CurrentLocationProjectionService.ts imports none of them', () => {
    expect(currentLocationServiceSource).not.toMatch(forbidden);
  });

  it('currentLocationProjectionRepository.ts imports none of them', () => {
    expect(currentLocationRepoSource).not.toMatch(forbidden);
  });

  it('the projection service never imports auditRepository — it must never write audit rows (spec §25)', () => {
    expect(currentLocationServiceSource).not.toMatch(/from ['"].*auditRepository['"]/);
    expect(currentLocationRepoSource).not.toMatch(/from ['"].*auditRepository['"]/);
  });
});

// Phase 4E — ETA Accuracy Validation guards.
const etaAccuracyServiceSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/EtaAccuracyService.ts'), 'utf8');
const etaAccuracyRepoSource = fs.readFileSync(path.resolve(__dirname, '../../server/repositories/etaAccuracyRepository.ts'), 'utf8');

describe('ETA accuracy validation never mutates governance/journey state (spec, mandatory)', () => {
  it('EtaAccuracyService.ts and etaAccuracyRepository.ts import none of the mutation modules', () => {
    const forbidden = /from ['"].*\/(JourneyService|JourneyStateMachine|ActionExecutor|PolicyEngine|MasaraOperationsAgent|PredictionEngine)['"]/;
    expect(etaAccuracyServiceSource).not.toMatch(forbidden);
    expect(etaAccuracyRepoSource).not.toMatch(forbidden);
  });

  it('the accuracy write path never accepts a client-supplied actualArrivalAt — the field is set only from server-derived journey data', () => {
    expect(etaAccuracyServiceSource).not.toMatch(/req\.(body|query)/);
    expect(etaAccuracyRepoSource).not.toMatch(/req\.(body|query)/);
  });

  it('reconciliation reads only journeyRepository — never audit_logs, never telemetry, as the ground-truth source', () => {
    expect(etaAccuracyServiceSource).not.toMatch(/from ['"].*auditRepository['"]/);
    expect(etaAccuracyServiceSource).not.toMatch(/from ['"].*telemetryObservationRepository['"]/);
  });
});

// Phase 5A — Parent Trust Read Model guards.
const parentRoutesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/parentRoutes.ts'), 'utf8');

describe('No generic event injection endpoint exists under /api/parent either (spec §13/§70/§120 regression, extended)', () => {
  it('the aggregate route-source check also covers parentRoutes.ts', () => {
    expect(allRoutesSource + parentRoutesSource).not.toMatch(/['"]\/api\/events['"]/);
    // Phase 5B adds exactly one narrow write (notification mark-read) — see
    // tests/services/parentJourneyService.test.ts for the precise guard on it.
    expect(parentRoutesSource).not.toMatch(/\.(put|patch|delete)\(/);
  });
});
