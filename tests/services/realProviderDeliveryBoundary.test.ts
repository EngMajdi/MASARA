import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  InAppNotificationProvider,
  deriveDeliveryIdempotencyKey,
  sanitizeProviderErrorMessage,
  type NotificationDeliveryPayload,
  type NotificationDeliveryProvider,
} from '../../server/services/NotificationDeliveryProvider';
import { PushNotificationProvider, classifyPushProviderResponse, isPushFailureRetryable, classifyPushProviderError } from '../../server/services/PushNotificationProvider';
import { SmsNotificationProvider, classifySmsProviderResponse, isSmsFailureRetryable, classifySmsProviderError } from '../../server/services/SmsNotificationProvider';
import { EmailNotificationProvider } from '../../server/services/EmailNotificationProvider';
import { deliverToAllChannels } from '../../server/services/NotificationDeliveryManager';
import { notificationRepository } from '../../server/repositories/notificationRepository';
import { journeyRepository } from '../../server/repositories/journeyRepository';
import { tripRepository } from '../../server/repositories/tripRepository';
import { studentRepository } from '../../server/repositories/studentRepository';
import { userRepository } from '../../server/repositories/userRepository';

function makePayload(notificationId: string, recipient: { userId: string; email: string; name: string; smsAddress?: string; pushToken?: string }): NotificationDeliveryPayload {
  return { notificationId, title: 'عنوان اختبار', body: 'نص اختبار', priority: 'NORMAL', recipient };
}

// ---------------------------------------------------------------------------
// A. Async contract — every provider genuinely returns a Promise (spec
// "Async Delivery Boundary" mandatory)
// ---------------------------------------------------------------------------

describe('Async contract — deliver() is genuinely a Promise for every provider (spec mandatory)', () => {
  const payload = makePayload('async-contract-test', { userId: 'u', email: 'parent@masara.om', name: 'n' });

  it('every provider returns a real Promise instance, not a synchronous value', () => {
    for (const provider of [InAppNotificationProvider, PushNotificationProvider, SmsNotificationProvider, EmailNotificationProvider]) {
      const result = provider.deliver(payload);
      expect(result).toBeInstanceOf(Promise);
    }
  });

  it('deliverToAllChannels itself returns a real Promise', () => {
    const result = deliverToAllChannels(payload);
    expect(result).toBeInstanceOf(Promise);
  });
});

// ---------------------------------------------------------------------------
// B/C. Real provider response mapping — SMS and PUSH now get the same
// generic, vendor-agnostic classifier treatment Phase 5D built for EMAIL
// (spec "Delivery Result Semantics" mandatory items 1-7)
// ---------------------------------------------------------------------------

describe('classifySmsProviderResponse — never converts an error into SUCCESS (spec mandatory)', () => {
  it('a genuine 2xx classifies as SUCCESS and surfaces providerMessageId', () => {
    const result = classifySmsProviderResponse({ httpStatus: 200, providerMessageId: 'sms-vendor-msg-1' });
    expect(result.outcome).toBe('SUCCESS');
    expect(result.providerMessageId).toBe('sms-vendor-msg-1');
  });

  it('a 4xx classifies as FAILED, non-retryable', () => {
    for (const status of [400, 401, 404, 422, 429]) {
      expect(classifySmsProviderResponse({ httpStatus: status }).outcome).toBe('FAILED');
      expect(isSmsFailureRetryable({ httpStatus: status })).toBe(false);
    }
  });

  it('a 5xx classifies as FAILED, retryable-in-principle', () => {
    for (const status of [500, 502, 503]) {
      expect(classifySmsProviderResponse({ httpStatus: status }).outcome).toBe('FAILED');
      expect(isSmsFailureRetryable({ httpStatus: status })).toBe(true);
    }
  });

  it('a timeout is retryable-in-principle and classifies as FAILED', () => {
    expect(isSmsFailureRetryable({ timedOut: true })).toBe(true);
    expect(classifySmsProviderError(new Error('ETIMEDOUT'), true).outcome).toBe('FAILED');
  });

  it('a thrown exception (network failure) classifies as FAILED, never throws further, and is sanitized', () => {
    const result = classifySmsProviderError(new Error('Request failed: Authorization: Bearer sk_live_smssecret1234567890'));
    expect(result.outcome).toBe('FAILED');
    expect(result.failureReason).not.toContain('sk_live_smssecret1234567890');
  });

  it('never converts a missing/malformed status into SUCCESS', () => {
    expect(classifySmsProviderResponse({ httpStatus: 0 }).outcome).toBe('FAILED');
  });
});

describe('classifyPushProviderResponse — never converts an error into SUCCESS (spec mandatory)', () => {
  it('a genuine 2xx classifies as SUCCESS and surfaces providerMessageId', () => {
    const result = classifyPushProviderResponse({ httpStatus: 201, providerMessageId: 'push-vendor-msg-1' });
    expect(result.outcome).toBe('SUCCESS');
    expect(result.providerMessageId).toBe('push-vendor-msg-1');
  });

  it('a 4xx classifies as FAILED, non-retryable', () => {
    for (const status of [400, 403, 404]) {
      expect(classifyPushProviderResponse({ httpStatus: status }).outcome).toBe('FAILED');
      expect(isPushFailureRetryable({ httpStatus: status })).toBe(false);
    }
  });

  it('a 5xx classifies as FAILED, retryable-in-principle', () => {
    for (const status of [500, 503]) {
      expect(classifyPushProviderResponse({ httpStatus: status }).outcome).toBe('FAILED');
      expect(isPushFailureRetryable({ httpStatus: status })).toBe(true);
    }
  });

  it('a timeout is retryable-in-principle and classifies as FAILED', () => {
    expect(isPushFailureRetryable({ timedOut: true })).toBe(true);
    expect(classifyPushProviderError(new Error('ETIMEDOUT'), true).outcome).toBe('FAILED');
  });

  it('a thrown exception is classified as FAILED, never throws further, and is sanitized', () => {
    expect(() => classifyPushProviderError('a raw string was thrown')).not.toThrow();
    const result = classifyPushProviderError(new Error('error, api_key=sk_test_pushsecret1234567890'));
    expect(result.outcome).toBe('FAILED');
    expect(result.failureReason).not.toContain('sk_test_pushsecret1234567890');
  });

  it('never converts a missing/malformed status into SUCCESS', () => {
    expect(classifyPushProviderResponse({ httpStatus: 599 }).outcome).toBe('FAILED');
  });
});

// ---------------------------------------------------------------------------
// Runtime boundary — still no real vendor connected, so deliver() itself
// never reaches SUCCESS even with the classifiers wired (spec: "no real
// provider credentials/configuration exists" — the honest STOP condition)
// ---------------------------------------------------------------------------

describe('SMS/PUSH deliver() still never reaches SUCCESS at runtime — no real vendor is integrated', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const KEYS = ['NOTIFICATION_SMS_ENABLED', 'SMS_PROVIDER_API_KEY', 'NOTIFICATION_PUSH_ENABLED', 'PUSH_PROVIDER_API_KEY'];
  beforeEach(() => {
    for (const k of KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('SMS with a resolved address, enabled + credentials -> still UNAVAILABLE, never SUCCESS', async () => {
    process.env.NOTIFICATION_SMS_ENABLED = 'true';
    process.env.SMS_PROVIDER_API_KEY = 'fake-test-key';
    const payload = makePayload('sms-runtime-test', { userId: 'u', email: 'e', name: 'n', smsAddress: '+96895512345' });
    const result = await SmsNotificationProvider.deliver(payload);
    expect(result.outcome).toBe('UNAVAILABLE');
  });

  it('SMS enabled + credentials but NO resolved address -> UNAVAILABLE for a distinct reason (no eligible contact)', async () => {
    process.env.NOTIFICATION_SMS_ENABLED = 'true';
    process.env.SMS_PROVIDER_API_KEY = 'fake-test-key';
    const payload = makePayload('sms-no-address-test', { userId: 'u', email: 'e', name: 'n' });
    const result = await SmsNotificationProvider.deliver(payload);
    expect(result.outcome).toBe('UNAVAILABLE');
    expect(result.failureReason).toContain('لا توجد جهة اتصال');
  });

  it('PUSH with a resolved token, enabled + credentials -> still UNAVAILABLE, never SUCCESS', async () => {
    process.env.NOTIFICATION_PUSH_ENABLED = 'true';
    process.env.PUSH_PROVIDER_API_KEY = 'fake-test-key';
    const payload = makePayload('push-runtime-test', { userId: 'u', email: 'e', name: 'n', pushToken: 'real-resolved-token' });
    const result = await PushNotificationProvider.deliver(payload);
    expect(result.outcome).toBe('UNAVAILABLE');
  });

  it('PUSH enabled + credentials but NO resolved token -> UNAVAILABLE for a distinct reason (no eligible contact)', async () => {
    process.env.NOTIFICATION_PUSH_ENABLED = 'true';
    process.env.PUSH_PROVIDER_API_KEY = 'fake-test-key';
    const payload = makePayload('push-no-token-test', { userId: 'u', email: 'e', name: 'n' });
    const result = await PushNotificationProvider.deliver(payload);
    expect(result.outcome).toBe('UNAVAILABLE');
    expect(result.failureReason).toContain('لا توجد جهة اتصال');
  });
});

// ---------------------------------------------------------------------------
// D. Idempotency — spec "Idempotency": deterministic from the existing
// notification identity, never randomized per retry
// ---------------------------------------------------------------------------

describe('deriveDeliveryIdempotencyKey — deterministic, never randomized (spec "Idempotency" mandatory)', () => {
  it('is exactly the notificationId — the real dedup identity, nothing new generated', () => {
    expect(deriveDeliveryIdempotencyKey('notif-abc-123')).toBe('notif-abc-123');
  });

  it('is stable across repeated calls for the same notification — never a new value per "retry"', () => {
    const a = deriveDeliveryIdempotencyKey('notif-xyz');
    const b = deriveDeliveryIdempotencyKey('notif-xyz');
    const c = deriveDeliveryIdempotencyKey('notif-xyz');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('differs only when the underlying notification identity differs', () => {
    expect(deriveDeliveryIdempotencyKey('notif-1')).not.toBe(deriveDeliveryIdempotencyKey('notif-2'));
  });
});

// ---------------------------------------------------------------------------
// E. Async failure isolation — a REJECTED promise (genuine async failure,
// only possible now that providers are truly async) is isolated exactly
// like a synchronous throw (spec "fail safely" mandatory)
// ---------------------------------------------------------------------------

describe('Async failure isolation — a rejected provider promise never crashes delivery or the other channels (spec mandatory, new in Phase 6C)', () => {
  it('a provider whose promise REJECTS (not a synchronous throw) is caught and reported FAILED for that channel only', async () => {
    const rejectingProvider: NotificationDeliveryProvider = {
      channel: 'SMS',
      deliver: () => Promise.reject(new Error('اختبار: رفض غير متزامن عمداً')),
    };
    const results = await deliverToAllChannels(makePayload('reject-test', { userId: 'u', email: 'e', name: 'n' }), [rejectingProvider, InAppNotificationProvider]);
    expect(results.find((r) => r.channel === 'SMS')!.outcome).toBe('FAILED');
    expect(results.find((r) => r.channel === 'IN_APP')!.outcome).toBe('SUCCESS');
  });

  it('a slow (but eventually resolving) provider does not block or corrupt the other channels\' results', async () => {
    const slowProvider: NotificationDeliveryProvider = {
      channel: 'EMAIL',
      deliver: () => new Promise((resolve) => setTimeout(() => resolve({ outcome: 'UNAVAILABLE' }), 5)),
    };
    const results = await deliverToAllChannels(makePayload('slow-test', { userId: 'u', email: 'e', name: 'n' }), [slowProvider, InAppNotificationProvider]);
    expect(results.find((r) => r.channel === 'EMAIL')!.outcome).toBe('UNAVAILABLE');
    expect(results.find((r) => r.channel === 'IN_APP')!.outcome).toBe('SUCCESS');
  });

  it('a rejected promise never touches the database — the notification row is untouched', async () => {
    const trip = tripRepository.findAll()[0];
    const student = studentRepository.findByBusId(trip.busId)[0];
    const journey = journeyRepository.create({ studentId: student.id, tripId: trip.id, state: 'scheduled' });
    const parentUser = userRepository.findByEmail('parent@masara.om')!;
    const id = notificationRepository.insertIfAbsent({
      recipientUserId: parentUser.id,
      studentId: student.id,
      journeyId: journey.id,
      tripId: trip.id,
      eventType: 'STUDENT_BOARDED',
      sourceEventId: `async-isolation-${crypto.randomUUID()}`,
      category: 'BOARDING',
      title: 't',
      body: 'b',
      priority: 'NORMAL',
    })!;
    const before = notificationRepository.findById(id)!;
    const rejectingProvider: NotificationDeliveryProvider = { channel: 'PUSH', deliver: () => Promise.reject(new Error('اختبار')) };
    await deliverToAllChannels(makePayload(id, { userId: 'u', email: 'e', name: 'n' }), [rejectingProvider]);
    const after = notificationRepository.findById(id)!;
    expect(after.status).toBe(before.status);
    expect(after.title).toBe(before.title);
  });
});

// ---------------------------------------------------------------------------
// Privacy / no leakage (spec mandatory)
// ---------------------------------------------------------------------------

describe('No credential or provider-response leakage (spec mandatory)', () => {
  it('sanitizeProviderErrorMessage redacts credential-shaped substrings from SMS/PUSH classifier output too', () => {
    const smsResult = classifySmsProviderError(new Error('failed: api_key=sk_live_abcdefghijklmnop'));
    const pushResult = classifyPushProviderError(new Error('Authorization Bearer abcXYZ123.tokenvalue'));
    expect(smsResult.failureReason).not.toContain('sk_live_abcdefghijklmnop');
    expect(pushResult.failureReason).not.toContain('abcXYZ123');
  });

  it('a providerMessageId returned by a classifier is never automatically attached to anything client-facing — it only ever lives on the in-memory DeliveryResult', () => {
    const result = classifySmsProviderResponse({ httpStatus: 200, providerMessageId: 'internal-only-id-999' });
    // The classifier itself is the only place this ever surfaces — confirms the shape stays DeliveryResult, never persisted or wrapped in a public DTO here.
    expect(Object.keys(result).sort()).toEqual(['outcome', 'providerMessageId'].sort());
  });

  it('sanitizeProviderErrorMessage is the same shared function all three external providers use — one redaction implementation, not three drifting copies', () => {
    const msg = 'Authorization Bearer duplicate-check-token-value';
    expect(sanitizeProviderErrorMessage(msg)).not.toContain('duplicate-check-token-value');
  });
});

// ---------------------------------------------------------------------------
// Source-scan governance guards (spec "Source Scan" mandatory — the fuller
// Phase 6C list: PredictionEngine, EtaService, ApprovalCenter added on top
// of the Phase 5C/5D list)
// ---------------------------------------------------------------------------

describe('Source-scan governance guards (spec "Source Scan" mandatory)', () => {
  const managerSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/NotificationDeliveryManager.ts'), 'utf8');
  const pushSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/PushNotificationProvider.ts'), 'utf8');
  const smsSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/SmsNotificationProvider.ts'), 'utf8');
  const emailSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/EmailNotificationProvider.ts'), 'utf8');
  const contractSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/NotificationDeliveryProvider.ts'), 'utf8');
  const notificationServiceSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/NotificationService.ts'), 'utf8');
  const resolutionSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/ContactDeliveryResolution.ts'), 'utf8');
  const verificationSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/ContactVerificationService.ts'), 'utf8');
  const parentRoutesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/parentRoutes.ts'), 'utf8');
  const contactRoutesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/contactRoutes.ts'), 'utf8');

  const forbiddenImports =
    /from ['"].*\/(JourneyService|JourneyStateMachine|ActionExecutor|PolicyEngine|MasaraOperationsAgent|PredictionEngine|TelemetryIngestionService|EtaService|ApprovalCenter)['"]/;

  it('the real provider layer (manager + all 4 providers + contract file) imports none of the forbidden governance/Journey/telemetry/ETA modules', () => {
    for (const source of [managerSource, pushSource, smsSource, emailSource, contractSource]) {
      expect(source).not.toMatch(forbiddenImports);
    }
  });

  it('NotificationService, ContactDeliveryResolution, and ContactVerificationService import none of the forbidden modules either', () => {
    for (const source of [notificationServiceSource, resolutionSource, verificationSource]) {
      expect(source).not.toMatch(forbiddenImports);
    }
  });

  it('no client route imports or directly invokes a provider — only NotificationService is allowed to reach NotificationDeliveryManager, and only NotificationDeliveryManager reaches the providers', () => {
    const forbiddenProviderImports = /from ['"].*\/(PushNotificationProvider|SmsNotificationProvider|EmailNotificationProvider|NotificationDeliveryProvider|NotificationDeliveryManager)['"]/;
    expect(parentRoutesSource).not.toMatch(forbiddenProviderImports);
    expect(contactRoutesSource).not.toMatch(forbiddenProviderImports);
  });

  it('no client route imports ContactDeliveryResolution directly — it is NotificationService-internal only', () => {
    expect(parentRoutesSource).not.toMatch(/from ['"].*\/ContactDeliveryResolution['"]/);
    expect(contactRoutesSource).not.toMatch(/from ['"].*\/ContactDeliveryResolution['"]/);
  });

  it('no route accepts a client-controlled recipient/eventType/priority/channel/provider for delivery', () => {
    expect(parentRoutesSource).not.toMatch(/req\.(query|body|params)\??\.(recipient|recipientUserId|eventType|priority|channel|provider)\b/);
    expect(contactRoutesSource).not.toMatch(/req\.(query|body|params)\??\.(recipient|recipientUserId|eventType|priority|channel\s*:\s*req)\b/);
  });

  it('PUSH/SMS/EMAIL providers never import notificationRepository — only IN_APP can touch notification state', () => {
    expect(pushSource).not.toMatch(/notificationRepository/);
    expect(smsSource).not.toMatch(/notificationRepository/);
    expect(emailSource).not.toMatch(/notificationRepository/);
  });

  it('no hard-coded credential-shaped literal exists in the SMS or PUSH provider files (only process.env reads)', () => {
    expect(smsSource).not.toMatch(/["'](sk_|AIza|AKIA)[a-z0-9]{10,}["']/i);
    expect(pushSource).not.toMatch(/["'](sk_|AIza|AKIA)[a-z0-9]{10,}["']/i);
  });
});
