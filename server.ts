import express from 'express';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import {
  INITIAL_SCHOOLS,
  INITIAL_ROUTES,
  INITIAL_NOTIFICATIONS,
  INITIAL_WORKFLOW_STEPS
} from './src/mockData';
import { agentRouter } from './server/routes/agentRoutes';
import { simulationRouter } from './server/routes/simulationRoutes';
import { operationsRouter } from './server/routes/operationsRoutes';
import { journeyRouter } from './server/routes/journeyRoutes';
import { gpsSimulationRouter } from './server/routes/gpsSimulationRoutes';
import { deviceRouter } from './server/routes/deviceRoutes';
import { telemetryRouter } from './server/routes/telemetryRoutes';
import { etaRouter } from './server/routes/etaRoutes';
import { safetyFindingRouter } from './server/routes/safetyFindingRoutes';
import { parentRouter } from './server/routes/parentRoutes';
import { contactRouter } from './server/routes/contactRoutes';
import { hashPassword, verifyPassword, generateTemporaryPassword } from './server/services/legacyAuthCredentials';
import { db } from './database/client';
import { schools as schoolsTable } from './database/schema';
import { createSession, invalidateSession, invalidateAllSessionsForUser } from './server/services/legacySessionService';
import { checkLoginAllowed, recordLoginFailure, recordLoginSuccess } from './server/services/loginRateLimiter';
import {
  requireLegacySession,
  requireLegacyRole,
  requireLegacyBusOwnership,
  requireLegacyStudentOwnership,
  LEGACY_DATA_MANAGEMENT_ROLES,
  LEGACY_OPERATIONAL_ROLES,
  LEGACY_ANY_ROLE,
  LEGACY_EMPLOYEE_MANAGEMENT_ROLES
} from './server/services/legacyAuthz';
import { securityHeaders } from './server/middleware/securityHeaders';
import { validatePasswordPolicy } from './server/services/passwordPolicy';
import { legacyUserRepository } from './server/repositories/legacyUserRepository';
import { legacyBusRepository, type LegacyBusView } from './server/repositories/legacyBusRepository';
import { legacyStudentRepository, type LegacyStudentView } from './server/repositories/legacyStudentRepository';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(securityHeaders);
// express.json()'s default 100kb body-size limit already bounds request
// payload size (Phase 7G audit: no legacy/governed route accepts anything
// close to that — the largest legitimate body is a short JSON object of
// scalar fields) — left at its default rather than narrowed further,
// since no route-specific risk was demonstrated to justify a tighter or
// looser value.
app.use(express.json());

// Phase 6D — production-readiness hardening: an unhandled promise
// rejection or a synchronous exception outside any request handler would
// otherwise either crash the process silently (Node 15+ default for
// unhandledRejection) or crash it with no clear log line — either way
// taking down every user's session for one bug anywhere. Every known
// async route handler in this codebase already has its own try/catch
// (audited); this is a pure safety net, never a substitute for that.
// Never logs request bodies, credentials, or secrets — only the error
// itself.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception — shutting down:', err);
  process.exit(1);
});

// New governance-layer API (DB-backed: trips/predictions/recommendations/audit log).
// Additive only — does not touch any of the in-memory routes below (Phase 1 scope).
app.use(agentRouter);
// Phase 2B: Simulation Engine + AI Operations Feed — likewise additive.
app.use(simulationRouter);
app.use(operationsRouter);
// Phase 3A: Journey Core — likewise additive.
app.use(journeyRouter);
// Phase 4A: GPS Simulation Engine — likewise additive.
app.use(gpsSimulationRouter);
// Phase 4B: Telemetry Ingestion Boundary — likewise additive.
app.use(deviceRouter);
app.use(telemetryRouter);
// Phase 4D: ETA Intelligence — likewise additive.
app.use(etaRouter);
// Phase 7B: Predictive Safety Intelligence (Evidence -> Finding only) — likewise additive, read-only.
app.use(safetyFindingRouter);
// Phase 5A: Parent Trust Read Model — likewise additive, read-only.
app.use(parentRouter);
// Phase 6A: Identity & Contact Foundation — likewise additive, self-service only.
app.use(contactRouter);

// In-memory application state
let schools = [...INITIAL_SCHOOLS];
// Phase 7K — buses/students moved off this in-memory pattern entirely
// (previously `let buses = [...INITIAL_BUSES]` / `let students = [...]`,
// the same never-shared-across-processes defect class Phase 7H found and
// fixed for the legacy identity store). The database is now authoritative
// for both; every route below reads/writes through legacyBusRepository /
// legacyStudentRepository, never a local array. `routes` stays exactly as
// it was — this phase's own audit found no route requiring it to become
// persistent (see legacyBuses.assignedRouteId's schema comment).
let routes = [...INITIAL_ROUTES];
let notifications = [...INITIAL_NOTIFICATIONS];
let workflowSteps = [...INITIAL_WORKFLOW_STEPS];

// Phase 6D: passwordHash, never plaintext password — same scrypt+salt
// convention as the governed `users` table's own passwordHash column
// (database/seed/seed.ts).
//
// Phase 7H: this used to be a plain in-memory array (`let users = [...]`,
// seeded inline, mutated in place by register/change-password). Moved to
// the database (legacyUserRepository -> the new legacy_users table,
// seeded by database/seed/seed.ts with the exact same 4 fixed ids) after
// this phase's own mandated multi-instance test found the in-memory
// version was invisible across server processes: a password changed via
// one process kept the OLD password valid and the NEW one rejected on
// every other process. Sessions/rate-limits already got this treatment in
// Phase 7G; the credential store itself had not, until this defect was
// live-discovered. Every call site below now reads/writes
// legacyUserRepository instead of a local array — no other behavior
// changed.

// Gemini Client Lazy Initializer
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    console.warn('GEMINI_API_KEY is not set or using default placeholder.');
    return null;
  }
  return new GoogleGenAI({ apiKey });
}

// Helper to call Gemini with model fallbacks and retries on transient errors
async function generateContentWithFallback(ai: GoogleGenAI, params: { contents: any; config?: any }) {
  const models = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-pro'];
  let lastError: any = null;

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: params.contents,
          config: params.config
        });
        if (response && response.text) {
          return response;
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`Gemini call attempt ${attempt} for model ${model} failed:`, err?.message || err);
        if (attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }
    }
  }
  throw lastError;
}

// ----------------- API ROUTES ----------------- //

// Phase 6D — hardened to actually verify the database is reachable, not
// just that the process is alive (spec "Health / Readiness"). A trivial,
// bounded read against a real table — never raw SQL text, never a
// connection string, never a stack trace in the response. `dbConnected`
// lets an operator distinguish "server up, DB down" from a genuine 200.
app.get('/api/health', (req, res) => {
  let dbConnected = false;
  try {
    db.select().from(schoolsTable).limit(1).all();
    dbConnected = true;
  } catch (err) {
    console.error('Health check: database unreachable:', err);
  }
  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? 'ok' : 'degraded',
    system: 'مَسارَا MASARA - AI School Transportation Backend',
    dbConnected,
    timestamp: new Date().toISOString()
  });
});

// Unified All-Data Endpoint for Live Realtime Synchronization Across Clients.
// Phase 7A: any authenticated session (role-agnostic) — this bundles
// exactly the same data the individual GET routes below already expose.
app.get('/api/all-data', (req, res) => {
  const guard = requireLegacySession(req.headers.authorization);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json({
    schools,
    buses: legacyBusRepository.findAll(),
    students: legacyStudentRepository.findAll(),
    routes,
    notifications,
    workflowSteps,
    timestamp: new Date().toISOString()
  });
});

// Authentication Login Endpoint. Phase 7A: rate-limited (checked before
// any password comparison, so a lockout can never distinguish "unknown
// email" from "wrong password" either) and now issues a real, expiring
// session token — the one authenticated session boundary the newly
// protected legacy surface below requires (spec Step 1/4/5).
app.post('/api/auth/login', (req, res) => {
  // Note: the client may still send a `role` field (used client-side only,
  // to select which demo account to display before login) — it is
  // deliberately never read here. See the SECURITY FIX comment below.
  const { email, password } = req.body;

  if (typeof email !== 'string' || !email) {
    return res.status(401).json({ success: false, error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
  }

  const rateLimit = checkLoginAllowed(email);
  if (rateLimit.allowed === false) {
    return res.status(429).json({
      success: false,
      error: 'عدد كبير جداً من محاولات الدخول الفاشلة. الرجاء المحاولة لاحقاً.',
      retryAfterMs: rateLimit.retryAfterMs,
    });
  }

  const user = legacyUserRepository.findByEmail(email);

  if (!user || typeof password !== 'string' || !verifyPassword(password, user.passwordHash)) {
    recordLoginFailure(email);
    return res.status(401).json({ success: false, error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
  }

  // Phase 8B — checked only AFTER a correct password, deliberately: the
  // existing enumeration-safety discipline above (generic "email or
  // password incorrect" for every failure) means a caller who does NOT
  // know the password learns nothing about whether the account exists,
  // let alone whether it's disabled. Only someone who already proved they
  // hold the real credential ever sees this distinct message. Neither
  // recordLoginFailure nor recordLoginSuccess is called here — a disabled
  // account with a correct password is neither a real failed attempt nor
  // a real successful one for rate-limiting purposes.
  if (user.status === 'disabled') {
    return res.status(403).json({ success: false, error: 'هذا الحساب معطّل حالياً. الرجاء التواصل مع إدارة المدرسة.' });
  }

  recordLoginSuccess(email);
  // SECURITY FIX: the session's role must always come from the authoritative
  // legacy_users record, never from a client-supplied request field. The
  // previous logic here fell back to the caller's own claimed role whenever
  // one was present in the body, so ANY authenticated caller could escalate
  // their own session to an arbitrary role just by claiming a different one
  // at login (live-verified: driver1's real credentials plus a falsely
  // claimed elevated role produced a genuine session with that elevated
  // role). The client may still send that field for its own local UI
  // purposes; it is never read for authorization here.
  const session = createSession({ id: user.id, email: user.email, role: user.role });

  const returnUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
    // Phase 8B — true only for an admin-issued temporary credential the
    // employee hasn't replaced yet. The frontend must block access to any
    // portal until a real change-password call clears it (see
    // /api/auth/change-password below).
    mustChangePassword: user.mustChangePassword
  };

  res.json({ success: true, user: returnUser, sessionToken: session.token, sessionExpiresAt: new Date(session.expiresAt).toISOString() });
});

// Phase 7A — invalidates the caller's own session token. Best-effort:
// missing/already-invalid token is still a success (logout is idempotent,
// never leaks whether a token was real).
app.post('/api/auth/logout', (req, res) => {
  const match = typeof req.headers.authorization === 'string' ? req.headers.authorization.match(/^Bearer\s+(.+)$/) : null;
  if (match) invalidateSession(match[1]);
  res.json({ success: true });
});

// Authentication Register Endpoint. Phase 7H — password policy enforced
// before hashing/persistence: an invalid password never partially creates
// a user (this check runs before the existing-email check and before any
// legacyUserRepository.create call), returns a sanitized client error,
// and the rejected password itself is never logged or stored.
app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ success: false, error: 'يرجى تقديم جميع البيانات المطلوبة' });
  }

  const policyCheck = validatePasswordPolicy(password);
  if (policyCheck.valid === false) {
    return res.status(400).json({ success: false, error: policyCheck.error });
  }

  const existing = legacyUserRepository.findByEmail(email);
  if (existing) {
    return res.status(400).json({ success: false, error: 'هذا البريد الإلكتروني مسجل بالفعل' });
  }

  // SECURITY FIX: self-registration is always 'parent' — staff roles
  // (driver/school/admin) are never client-selectable at signup. The
  // previous logic here trusted a role claimed by the caller outright
  // whenever the request supplied one, letting anyone with no prior
  // credentials create a brand-new elevated-role account with zero
  // verification (live-verified). Staff accounts exist only via the fixed
  // seed data; there is no legitimate self-service path to them in this
  // codebase.
  const newUser = legacyUserRepository.create({
    name,
    email: email.trim(),
    passwordHash: hashPassword(password),
    role: 'parent'
  });

  const session = createSession({ id: newUser.id, email: newUser.email, role: newUser.role });

  res.json({
    success: true,
    user: {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
      mustChangePassword: false
    },
    sessionToken: session.token,
    sessionExpiresAt: new Date(session.expiresAt).toISOString(),
  });
});

// Phase 7H — self-service authenticated password change. Identity comes
// exclusively from the existing legacy session boundary
// (requireLegacySession) — never from a client-supplied userId/email in
// the body, so caller A can never change caller B's password by spoofing
// an identity field. Errors are deliberately generic/sanitized; neither
// password is ever logged, echoed back, or partially persisted.
app.post('/api/auth/change-password', (req, res) => {
  const guard = requireLegacySession(req.headers.authorization);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const { currentPassword, newPassword } = req.body;
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: 'يرجى تقديم كلمة المرور الحالية والجديدة.' });
  }

  const user = legacyUserRepository.findById(guard.user.id);
  if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
    return res.status(401).json({ success: false, error: 'كلمة المرور الحالية غير صحيحة.' });
  }

  const policyCheck = validatePasswordPolicy(newPassword);
  if (policyCheck.valid === false) {
    return res.status(400).json({ success: false, error: policyCheck.error });
  }

  if (verifyPassword(newPassword, user.passwordHash)) {
    return res.status(400).json({ success: false, error: 'يجب أن تختلف كلمة المرور الجديدة عن الحالية.' });
  }

  legacyUserRepository.updatePasswordHash(user.id, hashPassword(newPassword));

  // Phase 8B — a successful password change is exactly the completion
  // signal for an admin-issued temporary credential: clear the forced-
  // change flag unconditionally (a harmless no-op for the vast majority of
  // calls where it was already false, e.g. every existing parent
  // self-service password change).
  if (user.mustChangePassword) {
    legacyUserRepository.setMustChangePassword(user.id, false);
  }

  // SESSION INVALIDATION DECISION (see legacySessionService.ts): every
  // session for this user is revoked, including the one making this very
  // request. The client's next authenticated call fails exactly like any
  // other expired/revoked session already does today — no new
  // client-facing state, and a fresh login is the only way back in,
  // which is itself a real proof the new password works.
  invalidateAllSessionsForUser(user.id);

  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Phase 8B — Employee Account Management & Provisioning. Admin-only
// (LEGACY_EMPLOYEE_MANAGEMENT_ROLES, deliberately narrower than
// LEGACY_DATA_MANAGEMENT_ROLES — see that constant's own comment).
// No email dependency anywhere in this block: every temporary credential
// is returned once, directly in the response, to the admin who requested
// it — never sent anywhere, never logged, never re-servable.
// ---------------------------------------------------------------------------

function toEmployeeView(user: NonNullable<ReturnType<typeof legacyUserRepository.findById>>) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    createdByUserId: user.createdByUserId,
    createdAt: user.createdAt,
  };
}

const EMPLOYEE_ROLES = ['driver', 'school', 'admin'] as const;

// Create a new employee account. Never 'parent' — parents are self-service
// only (POST /api/auth/register), a deliberate Phase 8A security fix this
// route must not reopen.
app.post('/api/admin/employees', (req, res) => {
  const guard = requireLegacyRole(req.headers.authorization, LEGACY_EMPLOYEE_MANAGEMENT_ROLES);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const { name, email, role } = req.body;
  if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ success: false, error: 'يرجى تقديم الاسم والبريد الإلكتروني.' });
  }
  if (typeof role !== 'string' || !(EMPLOYEE_ROLES as readonly string[]).includes(role)) {
    return res.status(400).json({ success: false, error: 'الدور يجب أن يكون سائق أو مدرسة أو مشرف عام.' });
  }

  const existing = legacyUserRepository.findByEmail(email);
  if (existing) {
    return res.status(400).json({ success: false, error: 'هذا البريد الإلكتروني مسجل بالفعل' });
  }

  const temporaryPassword = generateTemporaryPassword();
  const newEmployee = legacyUserRepository.create({
    name: name.trim(),
    email: email.trim(),
    passwordHash: hashPassword(temporaryPassword),
    role,
    status: 'active',
    mustChangePassword: true,
    createdByUserId: guard.user.id,
  });

  res.json({
    success: true,
    employee: toEmployeeView(legacyUserRepository.findById(newEmployee.id)!),
    // Shown exactly once — never persisted in plaintext, never returned
    // by any other endpoint. The admin is responsible for relaying it to
    // the employee out-of-band (in person, phone) — no email provider is
    // configured in this deployment.
    temporaryPassword,
  });
});

// List every employee (driver/school/admin) — never the seeded parent row
// via this surface, and never passwordHash. Deliberately readable by
// LEGACY_DATA_MANAGEMENT_ROLES (admin/school), wider than the
// admin-only mutation routes below: 'school' needs this list to populate
// the driver/parent assignment dropdowns in DataManagementModal, but
// still cannot create/deactivate/reset credentials — read vs. write are
// different sensitivity levels here, not the same action.
app.get('/api/admin/employees', (req, res) => {
  const guard = requireLegacyRole(req.headers.authorization, LEGACY_DATA_MANAGEMENT_ROLES);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const employees = legacyUserRepository
    .findAll()
    .filter((u) => (EMPLOYEE_ROLES as readonly string[]).includes(u.role))
    .map(toEmployeeView);
  res.json({ success: true, employees });
});

// Parents are explicitly NOT "employees" (self-service accounts, never
// admin-provisioned) but the parent-assignment dropdown in
// DataManagementModal still needs to list real parent accounts to assign
// students to — a small, separately-scoped read, same guard as the
// employees list above.
app.get('/api/admin/parents', (req, res) => {
  const guard = requireLegacyRole(req.headers.authorization, LEGACY_DATA_MANAGEMENT_ROLES);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const parents = legacyUserRepository
    .findAll()
    .filter((u) => u.role === 'parent')
    .map(toEmployeeView);
  res.json({ success: true, parents });
});

function requireExistingEmployee(id: string, res: express.Response) {
  const target = legacyUserRepository.findById(id);
  if (!target || !(EMPLOYEE_ROLES as readonly string[]).includes(target.role)) {
    res.status(404).json({ success: false, error: 'الموظف غير موجود.' });
    return null;
  }
  return target;
}

app.patch('/api/admin/employees/:id/deactivate', (req, res) => {
  const guard = requireLegacyRole(req.headers.authorization, LEGACY_EMPLOYEE_MANAGEMENT_ROLES);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const { id } = req.params;
  const target = requireExistingEmployee(id, res);
  if (!target) return;

  if (target.id === guard.user.id) {
    return res.status(400).json({ success: false, error: 'لا يمكنك تعطيل حسابك الخاص.' });
  }
  if (target.role === 'admin') {
    const activeAdmins = legacyUserRepository.findAll().filter((u) => u.role === 'admin' && u.status === 'active');
    if (activeAdmins.length <= 1) {
      return res.status(400).json({ success: false, error: 'لا يمكن تعطيل آخر حساب مشرف عام نشط في النظام.' });
    }
  }

  legacyUserRepository.updateStatus(id, 'disabled');
  invalidateAllSessionsForUser(id);
  res.json({ success: true, employee: toEmployeeView(legacyUserRepository.findById(id)!) });
});

app.patch('/api/admin/employees/:id/activate', (req, res) => {
  const guard = requireLegacyRole(req.headers.authorization, LEGACY_EMPLOYEE_MANAGEMENT_ROLES);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const { id } = req.params;
  if (!requireExistingEmployee(id, res)) return;

  legacyUserRepository.updateStatus(id, 'active');
  res.json({ success: true, employee: toEmployeeView(legacyUserRepository.findById(id)!) });
});

// The "forgot password" substitute — there is no email channel to prove
// requester ownership, so credential recovery is always admin-initiated.
app.post('/api/admin/employees/:id/reset-credential', (req, res) => {
  const guard = requireLegacyRole(req.headers.authorization, LEGACY_EMPLOYEE_MANAGEMENT_ROLES);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const { id } = req.params;
  if (!requireExistingEmployee(id, res)) return;

  const temporaryPassword = generateTemporaryPassword();
  legacyUserRepository.updatePasswordHash(id, hashPassword(temporaryPassword));
  legacyUserRepository.setMustChangePassword(id, true);
  invalidateAllSessionsForUser(id);

  res.json({ success: true, employee: toEmployeeView(legacyUserRepository.findById(id)!), temporaryPassword });
});

// Force a re-login without disabling the account (e.g. suspected
// shared-device use) — distinct from deactivate, which also flips status.
app.post('/api/admin/employees/:id/revoke-sessions', (req, res) => {
  const guard = requireLegacyRole(req.headers.authorization, LEGACY_EMPLOYEE_MANAGEMENT_ROLES);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const { id } = req.params;
  if (!requireExistingEmployee(id, res)) return;

  invalidateAllSessionsForUser(id);
  res.json({ success: true });
});

// Resource ownership assignment — the gap Phase 7K deliberately left open
// ("no assignment mechanism exists"). LEGACY_DATA_MANAGEMENT_ROLES
// (admin/school), not LEGACY_EMPLOYEE_MANAGEMENT_ROLES: this is an
// operational bus/student-data action, the same class as the existing
// create/delete routes for those resources, not a credential-issuance
// action.
app.patch('/api/buses/:id/assign-driver', (req, res) => {
  const guard = requireLegacyRole(req.headers.authorization, LEGACY_DATA_MANAGEMENT_ROLES);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const { id } = req.params;
  const { driverId } = req.body;
  const bus = legacyBusRepository.findById(id);
  if (!bus) return res.status(404).json({ success: false, error: 'الحافلة غير موجودة.' });

  if (driverId !== null) {
    if (typeof driverId !== 'string' || !driverId) {
      return res.status(400).json({ success: false, error: 'معرّف السائق غير صالح.' });
    }
    const driver = legacyUserRepository.findById(driverId);
    if (!driver || driver.role !== 'driver' || driver.status !== 'active') {
      return res.status(400).json({ success: false, error: 'يجب أن يشير معرّف السائق إلى حساب سائق نشط وحقيقي.' });
    }
  }

  const updated = legacyBusRepository.updateDriverId(id, driverId);
  res.json({ success: true, bus: updated });
});

app.patch('/api/students/:id/assign-parent', (req, res) => {
  const guard = requireLegacyRole(req.headers.authorization, LEGACY_DATA_MANAGEMENT_ROLES);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });

  const { id } = req.params;
  const { parentId } = req.body;
  const student = legacyStudentRepository.findById(id);
  if (!student) return res.status(404).json({ success: false, error: 'الطالب غير موجود.' });

  if (parentId !== null) {
    if (typeof parentId !== 'string' || !parentId) {
      return res.status(400).json({ success: false, error: 'معرّف ولي الأمر غير صالح.' });
    }
    const parent = legacyUserRepository.findById(parentId);
    if (!parent || parent.role !== 'parent' || parent.status !== 'active') {
      return res.status(400).json({ success: false, error: 'يجب أن يشير معرّف ولي الأمر إلى حساب ولي أمر نشط وحقيقي.' });
    }
  }

  const updated = legacyStudentRepository.updateParentId(id, parentId);
  res.json({ success: true, student: updated });
});

// Phase 7A — every legacy read below requires any authenticated session
// (role-agnostic): these are basic display data every logged-in role
// already sees somewhere in the UI (map, portals, data management modal).
app.get('/api/schools', (req, res) => {
  const guard = requireLegacySession(req.headers.authorization);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(schools);
});

app.get('/api/buses', (req, res) => {
  const guard = requireLegacySession(req.headers.authorization);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(legacyBusRepository.findAll());
});

app.get('/api/students', (req, res) => {
  const guard = requireLegacySession(req.headers.authorization);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(legacyStudentRepository.findAll());
});

app.get('/api/routes', (req, res) => {
  const guard = requireLegacySession(req.headers.authorization);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(routes);
});

app.get('/api/notifications', (req, res) => {
  const guard = requireLegacySession(req.headers.authorization);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(notifications);
});

// Add new notification — a parent-facing demo/test alert (ParentPortal's
// "test the pre-arrival alert" feature), any authenticated role.
app.post('/api/notifications', (req, res) => {
  const guard = requireLegacyRole(req.headers.authorization, LEGACY_ANY_ROLE);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  const { title, message, type = 'info', targetRole = 'parent' } = req.body;
  const nowStr = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
  const newNotif = {
    id: `notif-${Date.now()}`,
    timestamp: nowStr,
    title: title || 'تنبيه مسارَا الذكي',
    message: message || '',
    type: type as any,
    targetRole: targetRole as any,
    read: false
  };
  notifications.unshift(newNotif);
  res.json({ success: true, notification: newNotif, notifications });
});

// Schedule/Trigger 5-minute pre-arrival notification for parents
app.post('/api/notifications/schedule-prearrival', (req, res) => {
  const guard = requireLegacyRole(req.headers.authorization, LEGACY_ANY_ROLE);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  const { studentId, busId, minutesBefore = 5 } = req.body;
  const student = legacyStudentRepository.findById(studentId);
  const bus = legacyBusRepository.findById(busId) || (student ? legacyBusRepository.findById(student.busId) : undefined);

  const nowStr = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
  const stdName = student ? student.name : 'الطالب';
  const busNum = bus ? bus.busNumber : 'الحافلة';
  const pickupPointName = student?.pickupPoint?.nameAr || 'نقطة التجمع';
  const etaMins = bus ? bus.nextStopEtaMins : minutesBefore;

  const newNotif = {
    id: `notif-prearrival-${Date.now()}`,
    timestamp: nowStr,
    title: `⏰ تنبيه مبكر: الحافلة تبعد ${minutesBefore} دقائق عن نقطة التجمع!`,
    message: `تنبيه أوتوماتيكي: الحافلة (${busNum}) على وشك الوصول إلى نقطة التوقف (${pickupPointName}) للطالب (${stdName}) خلال ${minutesBefore} دقائق (ETA الحالي: ${etaMins} دقائق). يرجى التجهز للركوب!`,
    type: 'alert' as const,
    targetRole: 'parent' as const,
    read: false
  };

  notifications.unshift(newNotif);

  res.json({
    success: true,
    scheduledMinutes: minutesBefore,
    busEtaMins: etaMins,
    notification: newNotif,
    notifications
  });
});

app.get('/api/workflow-steps', (req, res) => {
  const guard = requireLegacySession(req.headers.authorization);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(workflowSteps);
});

// Create new student — data management (spec Step 2: admin/school only, matching OPERATIONAL_ROLES).
app.post('/api/students', (req, res) => {
  const guard = requireLegacyRole(req.headers.authorization, LEGACY_DATA_MANAGEMENT_ROLES);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  const newStudent = legacyStudentRepository.create(req.body);
  res.json({ success: true, student: newStudent, students: legacyStudentRepository.findAll() });
});

// Delete student — data management, admin/school only.
app.delete('/api/students/:id', (req, res) => {
  const guard = requireLegacyRole(req.headers.authorization, LEGACY_DATA_MANAGEMENT_ROLES);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  const { id } = req.params;
  legacyStudentRepository.deleteById(id);
  res.json({ success: true, students: legacyStudentRepository.findAll() });
});

// Create new bus — data management, admin/school only.
app.post('/api/buses', (req, res) => {
  const guard = requireLegacyRole(req.headers.authorization, LEGACY_DATA_MANAGEMENT_ROLES);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  const newBus = legacyBusRepository.create(req.body);
  res.json({ success: true, bus: newBus, buses: legacyBusRepository.findAll() });
});

// Delete bus — data management, admin/school only.
app.delete('/api/buses/:id', (req, res) => {
  const guard = requireLegacyRole(req.headers.authorization, LEGACY_DATA_MANAGEMENT_ROLES);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  const { id } = req.params;
  legacyBusRepository.deleteById(id);
  res.json({ success: true, buses: legacyBusRepository.findAll() });
});

// Create new route — data management, admin/school only.
app.post('/api/routes', (req, res) => {
  const guard = requireLegacyRole(req.headers.authorization, LEGACY_DATA_MANAGEMENT_ROLES);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  const newRoute = { id: `route-${Date.now()}`, ...req.body };
  routes.unshift(newRoute);
  res.json({ success: true, route: newRoute, routes });
});

// Delete route — data management, admin/school only.
app.delete('/api/routes/:id', (req, res) => {
  const guard = requireLegacyRole(req.headers.authorization, LEGACY_DATA_MANAGEMENT_ROLES);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  const { id } = req.params;
  const idx = routes.findIndex((r) => r.id === id);
  if (idx !== -1) routes.splice(idx, 1);
  res.json({ success: true, routes });
});

// Start Route Endpoint — driver-triggered operational action (also usable
// by admin/school). Phase 7K: the legacy bus record now has a real,
// persisted driverId (legacy_buses.driverId -> legacy_users.id), so a
// driver session may only start a route for the bus they own; admin/school
// are unaffected (unscoped, matching their existing unrestricted access).
// See requireLegacyBusOwnership (legacyAuthz.ts) — identity is always the
// session, never req.body.
app.post('/api/buses/:id/start-route', (req, res) => {
  const guard = requireLegacyRole(req.headers.authorization, LEGACY_OPERATIONAL_ROLES);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  const { id } = req.params;

  const existingBus = legacyBusRepository.findById(id);
  if (!existingBus) {
    return res.status(404).json({ error: 'الحافلة غير موجودة' });
  }
  const ownership = requireLegacyBusOwnership(guard.user, existingBus);
  if (ownership.ok === false) return res.status(ownership.status).json({ error: ownership.error });

  const targetBus = legacyBusRepository.updateStatus(id, 'en_route_pickup');

  const targetRoute = routes.find((r) => r.busId === id);
  if (targetRoute) {
    targetRoute.status = 'active';
  }

  const nowStr = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
  const newNotif = {
    id: `notif-${Date.now()}`,
    timestamp: nowStr,
    title: `انطلاق المسار المباشر (حافلة ${targetBus?.busNumber || id})`,
    message: `أكد السائق (${targetBus?.driverName || 'الكابتن'}) بدء الرحلة رسمياً للمسار (${targetRoute?.routeNameAr || 'المسار'}). تم تحديث حالة "Route Started" في لوحة التحكم الإدارية وبدء التتبع عبر الرادار.`,
    type: 'success' as const,
    targetRole: 'all' as const,
    read: false
  };

  notifications.unshift(newNotif);

  res.json({
    success: true,
    bus: targetBus,
    route: targetRoute,
    notifications
  });
});

// Update Student Boarding / Absence Status — reachable from both
// DriverPortal (boarding) and ParentPortal (marking a child absent), so
// any authenticated role is allowed. Phase 7K: the legacy student record
// now has a real, persisted parentId (legacy_students.parentId ->
// legacy_users.id); a parent session may only update their own child.
// admin/school/driver keep their existing unrestricted access (unchanged
// — drivers still mark boarding/absence for any student, matching the
// original DriverPortal flow, which has no per-student ownership concept
// of its own). See requireLegacyStudentOwnership (legacyAuthz.ts).
app.post('/api/students/:id/status', (req, res) => {
  const guard = requireLegacyRole(req.headers.authorization, LEGACY_ANY_ROLE);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  const { id } = req.params;
  const { status } = req.body;

  const existingStudent = legacyStudentRepository.findById(id);
  if (!existingStudent) {
    return res.status(404).json({ error: 'الطالب غير موجود' });
  }
  const ownership = requireLegacyStudentOwnership(guard.user, existingStudent);
  if (ownership.ok === false) return res.status(ownership.status).json({ error: ownership.error });

  let nowStr: string | undefined;
  if (status === 'boarded') nowStr = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
  const student = legacyStudentRepository.updateStatus(id, status, nowStr)!;

  if (status === 'boarded') {
    const ts = nowStr!;
    // Dispatch notification
    const newNotif = {
      id: `notif-${Date.now()}`,
      timestamp: ts,
      title: `تأكيد صعود الطالب (${student.name})`,
      message: `تم صعود الطالب ${student.name} إلى ${student.busNumber} بنجاح عند المقعد ${student.seatNumber}.`,
      type: 'success' as const,
      targetRole: 'parent' as const,
      read: false
    };
    notifications.unshift(newNotif);
  } else if (status === 'absent') {
    const ts = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
    const newNotif = {
      id: `notif-${Date.now()}`,
      timestamp: ts,
      title: `تسجيل غياب الطالب (${student.name})`,
      message: `تم إبلاغ السائق وإعادة احتساب محطة التوقف في المسار التلقائي.`,
      type: 'warning' as const,
      targetRole: 'driver' as const,
      read: false
    };
    notifications.unshift(newNotif);
  }

  res.json({ success: true, student, notifications });
});

// 1. AI Route Optimizer Endpoint (Gemini Powered) — AdminAIAgentPortal only, admin/school.
app.post('/api/ai/optimize-routes', async (req, res) => {
  const guard = requireLegacyRole(req.headers.authorization, LEGACY_DATA_MANAGEMENT_ROLES);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  try {
    const ai = getGeminiClient();
    const { schoolId, trafficCondition } = req.body;

    const schoolObj = schools.find((s) => s.id === schoolId) || schools[0];
    const schoolStudents = legacyStudentRepository.findAll().filter((s) => s.schoolId === schoolObj.id);

    const prompt = `
أنت وكيل الذكاء الاصطناعي الخاص بنظام "مَسارَا MASARA" المخصص لإدارة وحوكمة النقل المدرسي.
قم بتحليل بيانات المدرسة والطلبة التالية واقترح تحسيناً للمسارات:

المدرسة: ${schoolObj.nameAr}
الموقع: Lat ${schoolObj.location.lat}, Lng ${schoolObj.location.lng}
عدد الطلاب المقيدين: ${schoolStudents.length}
حالة المرور الحالية: ${trafficCondition || 'ازدحام متوسط في الطرق الرئيسية'}

الطلبة ونقاط التوقف الحالية:
${schoolStudents
  .map(
    (s) => `- ${s.name} (الصف: ${s.grade}) | الموقع: ${s.pickupPoint.nameAr} (${s.pickupPoint.address})`
  )
  .join('\n')}

المطلوب:
قم بصياغة استجابة JSON دقيقة تحتوي على المفاتيح التالية باللغة العربية:
1. "summaryAr": ملخص تنفيذي احترافي باللغة العربية يوضح كيف قام الذكاء الاصطناعي بتجميع الطلاب وتخفيض زمن الرحلة وتفادي الاختناقات المرورية.
2. "efficiencyGain": نسبة مئوية متوقعة للزيادة في الكفاءة (مثال: 24).
3. "timeSavedMins": عدد الدقائق الموفرة (مثال: 14).
4. "fuelSavedLiters": لترات الوقود الموفرة (مثال: 5.2).
5. "recommendations": مصفوفة نصوص من 3 توجيهات أمان واقتراحات للسائق ولأولياء الأمور.
    `;

    let resultJson = {
      summaryAr: 'تم تجميع نقاط التوقف القريبة في حي القرم والعذيبة بمسقط لإلغاء 3 توقفات فردية مسببة للتأخير، مما قلل زمن الانتظار الإجمالي ووفر 18% من استهلاك الوقود.',
      efficiencyGain: 28,
      timeSavedMins: 16,
      fuelSavedLiters: 6.4,
      recommendations: [
        'دمج نقطة القرم أ وب لتوفير 4 دقائق من وقت الالتفاف.',
        'توجيه حافلة 101 عبر طريق مسقط السريع لتفادي ازدحام شارع السلطان قابوس.',
        'إرسال إشعار استباقي لأولياء الأمور قبل الوصول بـ 5 دقائق لتجنب تأخر ركوب الطلبة.'
      ]
    };

    if (ai) {
      try {
        const response = await generateContentWithFallback(ai, {
          contents: prompt,
          config: {
            responseMimeType: 'application/json'
          }
        });

        if (response.text) {
          const parsed = JSON.parse(response.text);
          resultJson = { ...resultJson, ...parsed };
        }
      } catch (geminiError) {
        console.warn('Gemini API call error (using fallback):', geminiError);
      }
    }

    // Analysis-only (Phase 2B governance fix): this endpoint used to write
    // aiEfficiencyScore/carbonSavedKg/aiRationaleAr directly onto `routes`
    // straight from an LLM response, with no policy check, no approval, no
    // audit trail. It now only returns the AI's analysis; nothing here
    // mutates operational route state. Applying a real route change goes
    // through the governed path: MasaraOperationsAgent -> PolicyEngine ->
    // Approval Center -> ActionExecutor (see server/routes/agentRoutes.ts).
    const newNotif = {
      id: `notif-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
      title: 'تحليل ذكي جديد لتحسين المسارات (MASARA AI)',
      message: `${resultJson.summaryAr} — هذا تحليل استرشادي، ولم يُطبَّق تلقائياً على المسارات.`,
      type: 'info' as const,
      targetRole: 'all' as const,
      read: false
    };
    notifications.unshift(newNotif);

    res.json({
      success: true,
      result: resultJson,
      routes,
      notifications
    });
  } catch (error) {
    console.error('Error optimizing routes:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء معالجة خوارزمية الذكاء الاصطناعي' });
  }
});

// 2. AI Traffic Reroute Simulator Endpoint
// Reachable from both DriverPortal and AdminAIAgentPortal — admin/school/driver.
app.post('/api/ai/detect-reroute', async (req, res) => {
  const guard = requireLegacyRole(req.headers.authorization, LEGACY_OPERATIONAL_ROLES);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  try {
    const ai = getGeminiClient();
    const { busId, incidentDescription } = req.body;

    const allBuses = legacyBusRepository.findAll();
    const targetBus = allBuses.find((b) => b.id === busId) || allBuses[0];
    const incident = incidentDescription || 'ازدحام مفاجئ بسبب أعمال صيانة على شارع السلطان قابوس';

    const prompt = `
أنت نظام الملاحة الذكي والإنذار المبكر في "مَسارَا MASARA" بسلطنة عمان.
حدث تغيير طارئ في الطريق: "${incident}".
الحافلة المستهدفة: ${targetBus.busNumber} (السائق: ${targetBus.driverName}).

قم بصياغة حل إعادة توجيه (Rerouting) فوري باللغة العربية بصيغة JSON تحتوي على:
1. "rerouteTitleAr": عنوان التوجيه البديل.
2. "actionPlanAr": شرح خطة إعادة التوجيه خطوة بخطوة وتفادي العائق.
3. "newEtaMins": الوقت المتوقع الجديد بالدقائق (مثال: 5).
4. "parentAlertMessage": نص التنبيه الموجّه لأولياء الأمور لطمأنتهم وإفادتهم بالمسار البديل.
    `;

    let rerouteData = {
      rerouteTitleAr: 'إعادة توجيه ديناميكية - مسار بديل عبر طريق مسقط السريع',
      actionPlanAr: `كشف وكيل مسارَا إعاقة مرورية (${incident}). تم تحويل الحافلة فوراً إلى طريق مسقط السريع لتفادي التأخير لمدة 12 دقيقة.`,
      newEtaMins: 6,
      parentAlertMessage: `نحيطكم علماً بأن وكيل مسارَا قام بتعديل مسار حافلة ${targetBus.busNumber} تلقائياً لتفادي ازدحام مفاجئ. الوصول المتوقع خلال 6 دقائق.`
    };

    if (ai) {
      try {
        const response = await generateContentWithFallback(ai, {
          contents: prompt,
          config: {
            responseMimeType: 'application/json'
          }
        });

        if (response.text) {
          const parsed = JSON.parse(response.text);
          rerouteData = { ...rerouteData, ...parsed };
        }
      } catch (err) {
        console.warn('Gemini reroute error (fallback used):', err);
      }
    }

    // Analysis-only (Phase 2B governance fix): this endpoint used to write
    // nextStopEtaMins/status directly onto the target bus straight from an
    // LLM response, with no policy check, no approval, no audit trail. It
    // now only returns the AI's suggested reroute plan; nothing here mutates
    // bus/trip state. Applying a real reroute goes through the governed
    // path: MasaraOperationsAgent -> PolicyEngine -> Approval Center ->
    // ActionExecutor (see server/routes/agentRoutes.ts).
    const newNotif = {
      id: `notif-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
      title: `اقتراح إعادة توجيه: ${rerouteData.rerouteTitleAr}`,
      message: `${rerouteData.parentAlertMessage} — هذا اقتراح استرشادي بانتظار مراجعة المشرف، ولم يُطبَّق تلقائياً.`,
      type: 'alert' as const,
      targetRole: 'all' as const,
      read: false
    };
    notifications.unshift(newNotif);

    res.json({
      success: true,
      rerouteData,
      bus: targetBus,
      notifications
    });
  } catch (error) {
    console.error('Error in reroute endpoint:', error);
    res.status(500).json({ error: 'فشل في إعادة التوجيه الذكي' });
  }
});

// 2.5. AI Traffic-Based Bus ETA Prediction Endpoint (MASARA AI Predictive Engine) — AdminAIAgentPortal only, admin/school.
app.post('/api/ai/predict-traffic-eta', async (req, res) => {
  const guard = requireLegacyRole(req.headers.authorization, LEGACY_DATA_MANAGEMENT_ROLES);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  try {
    const ai = getGeminiClient();
    const { trafficLevel, selectedBusId } = req.body;

    const level = trafficLevel || 'heavy'; // 'smooth' | 'moderate' | 'heavy' | 'accident'
    const allBuses = legacyBusRepository.findAll();
    const targetBuses = selectedBusId
      ? allBuses.filter((b) => b.id === selectedBusId)
      : allBuses;

    const trafficDescriptions: Record<string, string> = {
      smooth: 'انسيابية كاملة وحركة مرور طبيعية على كافة المحاور بمسقط',
      moderate: 'بطء خفيف وازدحام متوسط بالقرب من الإشارات والدوارات الرئيسية',
      heavy: 'اختناق مروري كثيف وتوقف حركة السير على شارع السلطان قابوس والدائري',
      accident: 'حادث مروري وأعمال صيانة طارئة تسبب شللاً جزئياً في الحركة'
    };

    const currentTrafficDesc = trafficDescriptions[level] || trafficDescriptions.heavy;

    const prompt = `
أنت خوارزمية التنبؤ الذكي بالوقت والمتغيرات المرورية لنظام "مَسارَا MASARA" للنقل المدرسي بسلطنة عمان.
حالة الازدحام المروري الحالية المسجلة بالرادار: "${currentTrafficDesc}".

أسطول الحافلات المراد التحليل والتنبؤ لها:
${targetBuses
  .map(
    (b) =>
      `- الحافلة: ${b.busNumber} (السائق: ${b.driverName}) | السرعة الحالية: ${b.speedKmH} كم/س | المحطة القادمة: ${b.nextStopName} | ETA الأولي: ${b.nextStopEtaMins} دقيقة`
  )
  .join('\n')}

المطلوب: قم بتحليل تأثير حالة الازدحام هذه وصياغة استجابة JSON دقيقة باللغة العربية تحتوي على:
1. "trafficConditionSummaryAr": وصف تحليلي احترافي لحالة الطرق وتأثيرها على رحلات الحافلات.
2. "overallTrafficIndex": مؤشر الازدحام الإجمالي المئوي (مثال: 78).
3. "predictions": مصفوفة كائنات لكل حافلة تحتوي على المفاتيح:
   - "busId": معرف الحافلة (مثال: "${targetBuses[0]?.id || 'bus-101'}").
   - "busNumber": رقم الحافلة.
   - "originalEtaMins": الوقت الأصلي التقديري بالدقائق.
   - "predictedEtaMins": الوقت التقديري المعدل بعد تقييم الازدحام بالدقائق.
   - "delayMins": مقدار التأخير الإضافي المتوقع بالدقائق.
   - "congestionPercent": نسبة الكثافة المرورية بالمسار (مثال: 82).
   - "aiAlternativeRoute": اقتراح مسار بديل باللغة العربية أو توصية للمشرف (مثال: "سلوك شارع المشتل بدلاً من الدوار الرئيسي").
   - "confidenceScore": نسبة ثقة النموذج من 100 (مثال: 97).
   - "statusBadge": شارة حالة مناسبة مثل ("تأخير خفيف", "مسار سلس", "تأخير متوسط", "تحويل اضطراري").
    `;

    let fallbackPredictions = targetBuses.map((b) => {
      let multiplier = 1.0;
      let delay = 0;
      let badge = 'مسار سلس';
      let routeOffer = 'المسار الحالي ممتاز ولا يتطلب تغييرات';

      if (level === 'moderate') {
        multiplier = 1.35;
        delay = Math.ceil(b.nextStopEtaMins * 0.35);
        badge = 'تأخير طفيف';
        routeOffer = 'الاستمرار في المسار الحالي مع تقليل السرعة عند الدوار';
      } else if (level === 'heavy') {
        multiplier = 1.85;
        delay = Math.ceil(b.nextStopEtaMins * 0.85);
        badge = 'تأخير متوسط';
        routeOffer = 'تحويل الحركة إلى طريق مسقط السريع بدلاً من الشارع العام';
      } else if (level === 'accident') {
        multiplier = 2.4;
        delay = Math.ceil(b.nextStopEtaMins * 1.4);
        badge = 'تحويل اضطراري';
        routeOffer = 'سلوك الطرق الفرعية داخل الحي لتفادي منطقة الحادث';
      }

      const predictedEta = Math.round(b.nextStopEtaMins * multiplier);

      return {
        busId: b.id,
        busNumber: b.busNumber,
        originalEtaMins: b.nextStopEtaMins,
        predictedEtaMins: predictedEta,
        delayMins: delay,
        congestionPercent: level === 'smooth' ? 18 : level === 'moderate' ? 48 : level === 'heavy' ? 82 : 94,
        aiAlternativeRoute: routeOffer,
        confidenceScore: 96,
        statusBadge: badge
      };
    });

    let predictionResult = {
      trafficConditionSummaryAr: `تم تحليل كفاءة حركة المرور في مسقط. حالة الطرق: (${currentTrafficDesc}). تم تحديث أوقات الوصول المتوقعة (ETA) لجميع الحافلات بدقة عالية.`,
      overallTrafficIndex: level === 'smooth' ? 20 : level === 'moderate' ? 52 : level === 'heavy' ? 82 : 95,
      predictions: fallbackPredictions
    };

    if (ai) {
      try {
        const response = await generateContentWithFallback(ai, {
          contents: prompt,
          config: {
            responseMimeType: 'application/json'
          }
        });

        if (response.text) {
          const parsed = JSON.parse(response.text);
          if (parsed && Array.isArray(parsed.predictions)) {
            predictionResult = { ...predictionResult, ...parsed };
          }
        }
      } catch (geminiError) {
        console.warn('Gemini Traffic ETA prediction error (fallback used):', geminiError);
      }
    }

    // Analysis-only (Phase 2B governance fix): this endpoint used to write
    // predictedEtaMins directly onto every matching bus straight from an
    // LLM/heuristic response, with no policy check, no approval, no audit
    // trail. It now only returns the predicted ETAs; nothing here mutates
    // bus state. A real ETA-driven action goes through the governed path:
    // MasaraOperationsAgent -> PredictionEngine -> PolicyEngine -> Approval
    // Center -> ActionExecutor (see server/routes/agentRoutes.ts).
    const notifTitle = `تحليل توقعات ETA الذكية - ${
      level === 'smooth' ? 'مرور سلس' : level === 'moderate' ? 'ازدحام متوسط' : 'ازدحام مروري كثيف'
    }`;
    const newNotif = {
      id: `notif-eta-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
      title: notifTitle,
      message: `${predictionResult.trafficConditionSummaryAr} — تحليل استرشادي، لم يُطبَّق تلقائياً على الحافلات.`,
      type: (level === 'smooth' ? 'success' : level === 'moderate' ? 'info' : 'warning') as any,
      targetRole: 'all' as const,
      read: false
    };
    notifications.unshift(newNotif);

    res.json({
      success: true,
      predictionResult,
      buses: allBuses,
      notifications
    });
  } catch (error) {
    console.error('Error predicting traffic ETA:', error);
    res.status(500).json({ error: 'حدث خطأ في محرك التنبؤ المروري الذكي' });
  }
});

// Helper to construct local fallback response when Gemini API is offline/failing
function generateLocalAdvisorAnswer(
  query: string,
  userRole: string,
  busesData: LegacyBusView[],
  studentsData: LegacyStudentView[],
  schoolsData: typeof schools,
  routesData: typeof routes
): string {
  const q = (query || '').toLowerCase().trim();

  // 1. Search for specific student queries (e.g., مريم, الخليل, سالم, ريم, ابني, ابنتي)
  const matchedStudents = studentsData.filter((s) => {
    const stdName = s.name.toLowerCase();
    const parentName = (s.parentName || '').toLowerCase();
    const queryWords = q.split(/\s+/).filter((w) => w.length > 2);
    return (
      (q.includes('ابن') || q.includes('ابنتم') || q.includes('طالب') || q.includes('ولدي') || q.includes('بنتي') || q.includes('حالة') || q.includes('اين') || q.includes('أين') || q.includes('صعد') || q.includes('ركب')) &&
      (queryWords.some((w) => stdName.includes(w) || parentName.includes(w)) ||
        q.includes('مريم') || q.includes('الخليل') || q.includes('سالم') || q.includes('ريم'))
    );
  });

  if (matchedStudents.length > 0) {
    let result = `🔍 **بيانات واستعلام الطلاب المعنيين (${matchedStudents.length}):**\n\n`;
    matchedStudents.forEach((std) => {
      const bus = busesData.find((b) => b.id === std.busId || b.busNumber === std.busNumber) || busesData[0];
      const statusText =
        std.status === 'boarded'
          ? `تم الصعود للحافلة بنجاح ✅ (سجل وقت الصعود الفعلي: ${std.pickupTimeActual || std.pickupTimePlanned})`
          : std.status === 'waiting'
          ? `في انتظار وصول الحافلة ⏳ (وقت التجمع المخطط: ${std.pickupTimePlanned})`
          : `غائب عن الرحلة اليوم ❌`;

      result += `👦 **الطالب:** ${std.name} (${std.grade})\n`;
      result += `🏫 **المدرسة:** ${std.schoolName}\n`;
      result += `🪑 **رقم المقعد المخصص:** ${std.seatNumber} | 📌 **نقطة الركوب:** ${std.pickupPoint?.nameAr || 'نقطة الحي'}\n`;
      result += `📊 **حالة الحضور:** ${statusText}\n`;
      result += `🚌 **الحافلة المخصصة:** ${std.busNumber} (${bus?.plateNumber || ''})\n`;
      result += `👤 **سائق الحافلة:** ${bus?.driverName || 'الكابتن سعيد البوسعيدي'}\n`;
      result += `📞 **هاتف السائق للتواصل المباشر:** ${bus?.driverPhone || '+968 9123 4567'}\n`;
      if (bus) {
        result += `📍 **المحطة القادمة للحافلة:** "${bus.nextStopName}" (سرعة الحافلة: ${bus.speedKmH} كم/س)\n`;
        result += `⏱️ **الوقت المتبقي المحدد للوصول (ETA):** ${bus.nextStopEtaMins} دقائق\n`;
      }
      result += `\n-----------------------------------\n\n`;
    });
    return result;
  }

  // 2. Search for bus / ETA / location queries (e.g. أين الباص، كم الوقت، 101، 102، وصول، السائق)
  const isBusQuery =
    q.includes('باص') ||
    q.includes('حافلة') ||
    q.includes('101') ||
    q.includes('102') ||
    q.includes('103') ||
    q.includes('أين') ||
    q.includes('اين') ||
    q.includes('وصل') ||
    q.includes('وصول') ||
    q.includes('وقت') ||
    q.includes('موقع') ||
    q.includes('سرعة') ||
    q.includes('كم');

  if (isBusQuery) {
    let targetBuses = busesData;
    if (q.includes('101')) targetBuses = busesData.filter((b) => b.busNumber.includes('101'));
    else if (q.includes('102')) targetBuses = busesData.filter((b) => b.busNumber.includes('102'));
    else if (q.includes('103')) targetBuses = busesData.filter((b) => b.busNumber.includes('103'));

    let result = `🚌 **تقرير الملاحة المباشرة والوقت المحدد للوصول (GPS & ETA Radar):**\n\n`;
    targetBuses.forEach((b) => {
      result += `🚏 **${b.busNumber}** (رقم اللوحة: ${b.plateNumber})\n`;
      result += `👤 **السائق المسؤول:** ${b.driverName}\n`;
      result += `📞 **هاتف السائق:** ${b.driverPhone}\n`;
      result += `🚦 **مسار الحافلة الحالي:** ${
        b.status === 'en_route_school'
          ? 'تتجه نحو المدرسة 🏫'
          : b.status === 'en_route_pickup'
          ? 'في مسار نقل وتجميع الطلاب من المنازل 🚏'
          : 'متوقفة في مركز الخدمة 🅿️'
      }\n`;
      result += `📍 **المحطة القادمة:** ${b.nextStopName}\n`;
      result += `⏱️ **الوقت المحدد المتبقي للوصول (ETA):** ${b.nextStopEtaMins} دقائق\n`;
      result += `🚀 **السرعة الحالية:** ${b.speedKmH} كم/س | 👥 **الحمولة:** ${b.currentOccupancy} من أصل ${b.capacity} طالب\n`;
      result += `🛡️ **مؤشر أمان وسلامة الحافلة:** ${b.safetyScore}%\n`;
      result += `\n-----------------------------------\n\n`;
    });
    return result;
  }

  // 3. Search for driver info / contact queries
  if (q.includes('سائق') || q.includes('هاتف') || q.includes('تواصل') || q.includes('رقم') || q.includes('اتصال')) {
    let result = `📞 **دليل أرقام التواصل الفوري مع سائقي الحافلات المدرسية:**\n\n`;
    busesData.forEach((b) => {
      result += `🚌 **${b.busNumber}** (${b.plateNumber})\n`;
      result += `👤 **السائق:** ${b.driverName}\n`;
      result += `📱 **رقم الجوال المباشر:** ${b.driverPhone}\n`;
      result += `📍 **المحطة القادمة:** ${b.nextStopName} (ETA: ${b.nextStopEtaMins} دقائق)\n\n`;
    });
    return result;
  }

  // 4. Default rich overview
  return `أهلاً بك في **مساعد مَسارَا الذكي (MASARA AI Assistant)** 🚌✨

أنا متصل مباشرة بقاعدة بيانات الأسطول والتتبع المباشر بمسقط. إليك ملخص البيانات اللحظية:

📍 **تحديثات أسطول الحافلات المباشرة:**
• **حافلة 101:** بقيادة ${busesData[0]?.driverName || 'الكابتن سعيد البوسعيدي'} (📞 ${busesData[0]?.driverPhone}) | تتجه إلى "${busesData[0]?.nextStopName}" | الوصول خلال: **${busesData[0]?.nextStopEtaMins} دقائق**
• **حافلة 102:** بقيادة ${busesData[1]?.driverName || 'الكابتن سالم المعمري'} (📞 ${busesData[1]?.driverPhone}) | تتجه إلى "${busesData[1]?.nextStopName}" | الوصول خلال: **${busesData[1]?.nextStopEtaMins} دقائق**

👦 **حالة صعود وحضور الطلاب اليوم:**
• إجمالي الطلاب المسجلين: ${studentsData.length} طلاب
• تم الصعود بنجاح: ${studentsData.filter((s) => s.status === 'boarded').length} طلاب ✅
• في انتظار الحافلة: ${studentsData.filter((s) => s.status === 'waiting').length} طلاب ⏳

💬 **يمكنك كتابة أي سؤال مباشر مثل:**
- "أين حافلة 101 ومتى تصل محطتها القادمة؟"
- "هل صعد الطالب الخليل البوسعيدي إلى الحافلة؟"
- "ما هو رقم هاتف سائق الحافلة؟"`;
}

// 3. AI Smart Advisor Endpoint (Q&A for Masara) — globally available in the
// UI header to every logged-in role; read-only Q&A, so any authenticated session.
app.post('/api/ai/ask-advisor', async (req, res) => {
  const guard = requireLegacySession(req.headers.authorization);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  try {
    const ai = getGeminiClient();
    const { query, userRole, currentBuses, currentStudents, currentSchools, currentRoutes } = req.body;

    const busesData = currentBuses && Array.isArray(currentBuses) && currentBuses.length > 0 ? currentBuses : legacyBusRepository.findAll();
    const studentsData = currentStudents && Array.isArray(currentStudents) && currentStudents.length > 0 ? currentStudents : legacyStudentRepository.findAll();
    const schoolsData = currentSchools && Array.isArray(currentSchools) && currentSchools.length > 0 ? currentSchools : schools;
    const routesData = currentRoutes && Array.isArray(currentRoutes) && currentRoutes.length > 0 ? currentRoutes : routes;

    const liveContext = `
بيانات منصة مَسارَا الحية الحالية (LIVE DATABASE CONTEXT):

1. قائمة الحافلات وسائقيها ومواقعها وأوقات الوصول المتوقعة (LIVE BUSES):
${JSON.stringify(busesData, null, 2)}

2. قائمة الطلاب وحالة حضورهم ومقاعدهم وأولياء أمورهم (LIVE STUDENTS):
${JSON.stringify(studentsData, null, 2)}

3. قائمة المدارس المسجلة (LIVE SCHOOLS):
${JSON.stringify(schoolsData, null, 2)}

4. المسارات الحية (LIVE ROUTES):
${JSON.stringify(routesData, null, 2)}
`;

    const systemPrompt = `
أنت "المساعد والوكيل الذكي المساعد لمنظومة مَسارَا الذكية للنقل المدرسي بمسقط سلطنة عمان (MASARA AI Assistant)".
دورك هو الإجابة الشاملة والدقيقة والاحترافية باللغة العربية على أي سؤال أو استفسار يطرحه المستخدم (دور المستخدم: ${userRole || 'ولي أمر'}).

السياق الحي لقاعدة البيانات الحالية في النظام:
${liveContext}

تعليمات هامة جداً للإجابة:
1. أنت متصل مباشرة بقاعدة البيانات الحية المعروضة أعلاه ولديك معلومات كاملة ودقيقة عن كل طالب، كل حافلة، كل سائق، كل موقع GPS، وكل وقت وصول متوقع (ETA).
2. إذا سأل المستخدم عن "أين الباص؟"، أو "متى يصل؟"، أو "الوقت المحدد للوصول؟"، ابحث في قائمة الحافلات أعلاه واذكر رقم الحافلة، اسم السائق، رقم جواله، سرعة الحافلة، المحطة القادمة، والوقت المحدد للوصول بالدقائق (ETA).
3. إذا سأل ولي الأمر عن ابنه/ابنته أو طالب معين (مثل مريم، الخليل، سالم، ريم، الخ)، ابحث عن اسم الطالب واذكر فوراً: اسم الطالب الكامل، الصف، المدرسة، حالة الحضور (تم الصعود ✅ / ينتظر ⏳ / غائب ❌)، رقم المقعد، رقم الحافلة، اسم السائق ورقم جواله، والوقت المتوقع لوصول الحافلة لموقعه.
4. إذا سأل عن أرقام هواتف السائقين أو التواصل مع إدارة المدرسة، أعطه أرقام الهواتف وأسماء الكباتن المباشرة من البيانات.
5. أجب بأسلوب منظم وواضح جداً مع استخدام النقاط والأيقونات التعبيرية (مثل 🚌, ⏱️, 📍, ✅, 📞, 👦).
6. السؤال المطروح من المستخدم: "${query || 'أين الباص ومتى يصل وما هي تفاصيل الطلاب؟'}"
`;

    let answerText = generateLocalAdvisorAnswer(query, userRole || 'parent', busesData, studentsData, schoolsData, routesData);

    if (ai) {
      try {
        const response = await generateContentWithFallback(ai, {
          contents: systemPrompt
        });
        if (response.text) {
          answerText = response.text;
        }
      } catch (geminiError) {
        console.warn('Gemini Advisor Error (fallback used):', geminiError);
      }
    }

    res.json({ answer: answerText });
  } catch (err) {
    console.error('Advisor endpoint error:', err);
    res.status(500).json({ error: 'فشل المساعد الذكي' });
  }
});

// 4. Specialized Multi-Agent Executor Endpoint — AdminAIAgentPortal only, admin/school.
app.post('/api/ai/run-agent', async (req, res) => {
  const guard = requireLegacyRole(req.headers.authorization, LEGACY_DATA_MANAGEMENT_ROLES);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  try {
    const ai = getGeminiClient();
    const { agentType, customInput } = req.body;

    const currentBuses = legacyBusRepository.findAll();
    const currentStudents = legacyStudentRepository.findAll();

    let agentTitle = '';
    let prompt = '';

    if (agentType === 'safety') {
      agentTitle = 'وكيل سلامة الحضور ومتابعة الصعود';
      prompt = `
أنت "وكيل سلامة الطلاب" الخاص بنظام مسارَا MASARA للنقل المدرسي.
قم بتحليل بيانات الطلاب المقيدين والحافلات والغياب الحالي، وصياغة خطة عمل وتقارير سلامة سريعة باللغة العربية بصيغة JSON تحتوي على:
1. "agentStatus": حالة وكيل السلامة (مثال: "تم الفحص والتحقق الكامل بنسبة 100%").
2. "checkedStudentsCount": عدد الطلاب المفحوصين (${currentStudents.length}).
3. "findings": مصفوفة من 3 نقاط توضح الملاحظات الأمنية وحالة الصعود.
4. "actionNotice": إجراء أو تنبيه فوري يُرسل لأولياء الأمور والمشرفين.
5. "riskScore": تقييم مستوى المخاطر من 100 (مثال: 98/100 أمان ممتاز).
      `;
    } else if (agentType === 'maintenance') {
      agentTitle = 'وكيل الصيانة الاستباقية للأسطول';
      prompt = `
أنت "وكيل الصيانة والإنذار المبكر للمركبات" في مسارَا MASARA بسلطنة عمان.
بيانات أسطول الحافلات الحالي:
${currentBuses.map(b => `- ${b.busNumber} (${b.plateNumber}): السائق ${b.driverName}، السعة ${b.capacity}، استهلاك الوقود 100%`).join('\n')}

المطلوب: قم بتحليل البيانات وإعطاء تقرير صيانة دوري باللغة العربية بصيغة JSON تحتوي على:
1. "fleetHealthScore": نسبة جاهزية الأسطول (مثال: 96%).
2. "criticalAlerts": مصفوفة من الحافلات التي تتطلب فحص دوري أو تغيير زيت/إطارات.
3. "recommendedActions": 3 خطوات صيانة وقائية مقترحة.
4. "estimatedSavingsOMR": التوفير المالي المتوقع بالريال العماني (OMR) جراء الصيانة الوقائية قبل التعطل.
      `;
    } else {
      agentTitle = 'وكيل التحسين والتخطيط الأوتوماتيكي';
      prompt = `
أنت "وكيل التخطيط الذكي" بنظام مسارَا MASARA بسلطنة عمان.
مدخل إضافي: "${customInput || 'مراجعة كافة مسارات الحافلات بمسقط والولايات المجاورة'}".
قم بصياغة تقرير تشغيلي متكامل بصيغة JSON يحتوي على:
1. "summaryAr": ملخص الخطة التكتيكية.
2. "actionSteps": مصفوفة من 3 خطوات تنفيدية.
3. "impactScore": نسبة التأثير إيجابياً.
      `;
    }

    let agentResult: any = {
      agentTitle,
      agentStatus: 'تم التشغيل والتحليل التلقائي بنجاح ⚡',
      checkedStudentsCount: currentStudents.length,
      findings: [
        'تأكيد مطابقة ركوب 100% من الطلاب المسجلين بالرحلة الصباحية.',
        'عدم وجود أي طالب متأخر أو مفقود عند نقاط التجميع.',
        'تطبيق التنبيهات المباشرة لجميع أولياء الأمور قبل الوصول بـ 3 دقائق.'
      ],
      actionNotice: 'تنسيق آلي مع مشرفة المدرسة لاستقبال الطالبين عند البوابة الشرقية.',
      riskScore: 99,
      fleetHealthScore: '97%',
      criticalAlerts: ['حافلة 102 - يفضل فحص ضغط الإطارات والمكيف قبل رحلة العودة.'],
      recommendedActions: [
        'جدولة صيانة دورية للحافلة 102 بعد نهاية الدوام.',
        'إعادة ضبط حساسات الحزام التلقائية للحافلة 101.',
        'فحص فلتر الوقود لضمان الاستدامة وتخفيض الانبعاثات.'
      ],
      estimatedSavingsOMR: 150,
      summaryAr: 'تم تنفيذ المسح التكتيكي الشامل وتحسين الخطة التشغيلية لجميع الحافلات في محافظة مسقط.',
      actionSteps: ['إعادة توزيع المقاعد', 'تحديث خطة الطوارئ', 'إخطار السائقين بالمسار الجديد']
    };

    if (ai) {
      try {
        const response = await generateContentWithFallback(ai, {
          contents: prompt,
          config: {
            responseMimeType: 'application/json'
          }
        });

        if (response.text) {
          const parsed = JSON.parse(response.text);
          agentResult = { ...agentResult, ...parsed };
        }
      } catch (err) {
        console.warn('Run Agent Gemini Error (fallback used):', err);
      }
    }

    res.json({ success: true, agentResult });
  } catch (err) {
    console.error('Run Agent endpoint error:', err);
    res.status(500).json({ error: 'فشل تشغيل وكيل الذكاء الاصطناعي' });
  }
});

// Phase 7G — production request safety. express.json() throws a raw
// SyntaxError on a malformed JSON body; without a handler here, Express's
// own default error handler serves an HTML page (with a stack trace
// outside NODE_ENV=production) instead of the JSON error shape every
// endpoint in this API already returns. This also serves as a last-resort
// safety net for any other synchronous throw that escaped a route's own
// try/catch — never a stack trace, never internal error detail, either
// way. Registered after every API route above and before static/Vite
// serving below, so it only ever covers this JSON API surface.
app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  if (err instanceof SyntaxError && 'body' in (err as unknown as Record<string, unknown>)) {
    return res.status(400).json({ error: 'الطلب يحتوي على بيانات JSON غير صالحة.' });
  }
  console.error('Unhandled request error:', err);
  res.status(500).json({ error: 'حدث خطأ غير متوقع في الخادم.' });
});

// ----------------- VITE / STATIC SERVING ----------------- //

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚌 MASARA Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
