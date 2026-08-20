import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Phase 7E — "production notification provider readiness" audit concluded
// with a STOP at the external transport boundary: no real EMAIL/SMS/PUSH
// vendor SDK, credential, or configuration exists anywhere in this
// repository or its deployment. No provider code was written this phase.
//
// These tests exist to make that STOP condition itself a durable,
// regression-tested fact rather than a one-time audit note that silently
// goes stale. If a future phase adds real credentials/SDK without also
// wiring a genuine transport call, these tests catch exactly that gap —
// the "invented success" anti-pattern this project explicitly forbids
// (spec: "no fake credentials, no fake provider, no fake successful
// delivery"). They import no fixtures, no test doubles, no fake vendor —
// only the real, already-committed package.json/.env.example/source files.

const repoRoot = path.resolve(__dirname, '../..');

const KNOWN_VENDOR_SDK_PACKAGES = [
  'nodemailer',
  '@sendgrid/mail',
  'sendgrid',
  'twilio',
  'mailgun-js',
  'mailgun.js',
  'resend',
  'postmark',
  'aws-sdk',
  '@aws-sdk/client-ses',
  '@aws-sdk/client-sns',
  'firebase-admin',
  'web-push',
  '@azure/communication-email',
  'onesignal-node',
];

describe('Phase 7E — no real provider SDK is installed (STOP condition, durable)', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const allDeps = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) };

  it('package.json declares none of the common email/SMS/push vendor SDKs', () => {
    for (const pkg of KNOWN_VENDOR_SDK_PACKAGES) {
      expect(Object.keys(allDeps)).not.toContain(pkg);
    }
  });

  it('none of the known vendor SDK packages are actually installed in node_modules', () => {
    for (const pkg of KNOWN_VENDOR_SDK_PACKAGES) {
      expect(fs.existsSync(path.join(repoRoot, 'node_modules', pkg))).toBe(false);
    }
  });
});

describe('Phase 7E — no real provider credential exists in this process or repository (STOP condition, durable)', () => {
  it('none of the provider credential/base-url environment variables are set in this process', () => {
    const credentialVarNames = [
      'EMAIL_PROVIDER_API_KEY',
      'SMS_PROVIDER_API_KEY',
      'PUSH_PROVIDER_API_KEY',
      'EMAIL_PROVIDER_BASE_URL',
      'SMS_PROVIDER_BASE_URL',
      'PUSH_PROVIDER_BASE_URL',
      'SENDGRID_API_KEY',
      'TWILIO_AUTH_TOKEN',
      'TWILIO_ACCOUNT_SID',
    ];
    for (const name of credentialVarNames) {
      expect(process.env[name] ?? '').toBe('');
    }
  });

  it('no .env file exists at the repository root (only .env.example, which must stay placeholder-only)', () => {
    expect(fs.existsSync(path.join(repoRoot, '.env'))).toBe(false);
  });

  it('.env.example keeps every provider channel disabled and every credential placeholder empty — never a real-looking value', () => {
    const envExample = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
    expect(envExample).toMatch(/NOTIFICATION_EMAIL_ENABLED="false"/);
    expect(envExample).toMatch(/NOTIFICATION_SMS_ENABLED="false"/);
    expect(envExample).toMatch(/NOTIFICATION_PUSH_ENABLED="false"/);
    expect(envExample).toMatch(/EMAIL_PROVIDER_API_KEY=""/);
    expect(envExample).toMatch(/SMS_PROVIDER_API_KEY=""/);
    expect(envExample).toMatch(/PUSH_PROVIDER_API_KEY=""/);
  });
});

describe('Phase 7E — the provider files themselves still make no real transport call (source-scan, complements the runtime UNAVAILABLE tests)', () => {
  // Strips // line comments before matching — each provider's header/inline
  // comments deliberately describe, in prose, the hypothetical
  // `await fetch(vendorUrl, ...)` a future real integration would make
  // (documenting the intended integration point); that prose must not be
  // mistaken for a live call.
  const files = [
    'server/services/EmailNotificationProvider.ts',
    'server/services/SmsNotificationProvider.ts',
    'server/services/PushNotificationProvider.ts',
  ].map((f) =>
    fs
      .readFileSync(path.join(repoRoot, f), 'utf8')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n')
  );

  it('no provider file calls fetch/http/https/axios in live code — no transport client exists to call yet', () => {
    for (const source of files) {
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/from ['"](node:)?https?['"]/);
      expect(source).not.toMatch(/from ['"]axios['"]/);
    }
  });

  it('each provider credential env var is read only inside its own provider file — never duplicated elsewhere, never exposed to unrelated modules', () => {
    const executorSource = fs.readFileSync(path.join(repoRoot, 'server/services/ActionExecutor.ts'), 'utf8');
    const notifierSource = fs.readFileSync(path.join(repoRoot, 'server/services/SchoolRecommendationNotifier.ts'), 'utf8');
    const managerSource = fs.readFileSync(path.join(repoRoot, 'server/services/NotificationDeliveryManager.ts'), 'utf8');
    for (const source of [executorSource, notifierSource, managerSource]) {
      expect(source).not.toMatch(/EMAIL_PROVIDER_API_KEY|SMS_PROVIDER_API_KEY|PUSH_PROVIDER_API_KEY/);
    }
  });
});
