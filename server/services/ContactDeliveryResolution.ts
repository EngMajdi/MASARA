import { userContactRepository } from '../repositories/userContactRepository';
import type { GovernedUser } from './authz';

// Phase 6B — server-side-ONLY contact resolution for notification delivery.
// This file is imported by NotificationService and NOTHING ELSE — never a
// route, never returned through any API. The raw addresses it resolves
// must never reach a response; contrast with UserContactService's
// ContactView, which is the only contact shape any client ever sees.
//
// CORE RULE (spec): only a verified + enabled user_contacts row is ever
// eligible for external delivery. userContactRepository.findEligibleForDelivery
// is the single query this file (and therefore all of notification
// delivery) is allowed to read contact addresses from — it already filters
// to verified + enabled and applies the deterministic selection policy
// (most recently verified wins, ties by most recently updated, then id).
//
// LEGACY EMAIL FALLBACK POLICY (spec "Email Fallback Policy" — the one
// deterministic precedence rule this phase defines and tests):
//   1. a verified + enabled EMAIL user_contact — the governed contact
//      model is the source of truth going forward.
//   2. users.email, ONLY when no eligible EMAIL contact exists at all.
//      This is the pre-existing Phase 5B/5C/5D behavior, preserved for
//      every user who has never added/verified an EMAIL contact.
//   3. An unverified or disabled EMAIL contact is NEVER used, and NEVER
//      silently treated as absent-then-fallback in a way that could be
//      confused with "the contact was rejected so we tried something
//      else" — the fallback is to the account's own login email
//      specifically, a fact that pre-dates contacts entirely, not a
//      bypass of the unverified/disabled state.
//
// SMS/PUSH have no legacy field to fall back to — `users` has no phone or
// push-token column (confirmed unchanged since the Phase 5D/6A audits).
// No eligible contact means no address at all, and the corresponding
// provider reports UNAVAILABLE for exactly that reason (see
// SmsNotificationProvider.ts / PushNotificationProvider.ts).

export type EmailResolution = { address: string; source: 'CONTACT' | 'LEGACY_FALLBACK' };

/** EMAIL only: prefers a verified+enabled contact, falls back to the governed users.email otherwise. Never fabricates, never uses an unverified/disabled contact. */
export function resolveEmailAddress(user: GovernedUser): EmailResolution {
  const contact = userContactRepository.findEligibleForDelivery(user.id, 'EMAIL');
  if (contact) return { address: contact.value, source: 'CONTACT' };
  return { address: user.email, source: 'LEGACY_FALLBACK' };
}

/** SMS: no legacy fallback exists — null means "no eligible address", never a guess. */
export function resolveSmsAddress(userId: string): string | null {
  return userContactRepository.findEligibleForDelivery(userId, 'SMS')?.value ?? null;
}

/** PUSH: no legacy fallback exists — null means "no eligible address", never a guess. */
export function resolvePushToken(userId: string): string | null {
  return userContactRepository.findEligibleForDelivery(userId, 'PUSH')?.value ?? null;
}
