import { userContactRepository, isUniqueConstraintError } from '../repositories/userContactRepository';
import { normalizeContactValue, maskContactValue, ContactValidationError } from './ContactNormalization';
import { isValidContactChannel, type ContactChannel, type ContactView } from '../domain/contactContract';
import type { GovernedUser } from './authz';

// Phase 6A — the ONE service that ever writes to user_contacts. This file
// imports NO mutating function from JourneyService, ActionExecutor,
// PolicyEngine, or MasaraOperationsAgent, never writes telemetry/current-
// location/ETA, and never creates a notification or audit_logs row — a
// contact is configuration data, not an operational event (spec §17/§20).
//
// TRUSTED IDENTITY -> OWN CONTACTS ONLY: every function here takes the
// already-authenticated GovernedUser (resolved by authz.requireAuthenticatedUser
// from the caller's own session) as its FIRST argument and derives
// ownership from it — never from a client-supplied userId (spec §9/§14).
// Ownership of an EXISTING contact is re-verified from the row itself on
// every read/update/delete (never trusted from the :id alone).

export class ContactNotFoundError extends Error {}
export class ContactAccessDeniedError extends Error {}
export class DuplicateContactError extends Error {}
export { ContactValidationError };

type ContactRow = NonNullable<ReturnType<typeof userContactRepository.findById>>;

function requireOwnContact(user: GovernedUser, contactId: string): ContactRow {
  const row = userContactRepository.findById(contactId);
  if (!row) throw new ContactNotFoundError('جهة الاتصال غير موجودة.');
  if (row.userId !== user.id) throw new ContactAccessDeniedError('هذه جهة الاتصال لا تخص هذا الحساب.');
  return row;
}

function toView(row: ContactRow): ContactView {
  return {
    id: row.id,
    channel: row.channel as ContactChannel,
    masked: maskContactValue(row.channel as ContactChannel, row.value),
    verified: row.verifiedAt !== null,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Bounded — a user has, realistically, a handful of contacts (spec's own pilot scale). */
export function listContactsForUser(user: GovernedUser): ContactView[] {
  return userContactRepository.findByUserId(user.id).map(toView);
}

/**
 * Creates a new contact for the AUTHENTICATED user only. `channel` is
 * validated against the closed CONTACT_CHANNELS set (spec §5 — never an
 * arbitrary client string); `verifiedAt` is never accepted as input (spec
 * §8 — always starts unverified; a seed-only exception is documented in
 * seed.ts, never a client-reachable path).
 */
export function createContact(user: GovernedUser, input: { channel: unknown; value: unknown }): ContactView {
  if (!isValidContactChannel(input.channel)) {
    throw new ContactValidationError('قناة الاتصال غير مدعومة.');
  }
  const { value, normalizedValue } = normalizeContactValue(input.channel, input.value);

  try {
    const inserted = userContactRepository.create({
      userId: user.id,
      channel: input.channel,
      value,
      normalizedValue,
      verifiedAt: null,
      enabled: true,
    });
    return toView(userContactRepository.findById(inserted.id)!);
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new DuplicateContactError('جهة الاتصال هذه مسجّلة بالفعل لهذا الحساب.');
    }
    throw err;
  }
}

/**
 * Updates only `value` and/or `enabled` on the caller's OWN contact.
 * `channel`, `userId`, and `verifiedAt` are never accepted as input (spec
 * §8/§9/§11) — changing a contact's channel is really a different contact,
 * not an edit.
 */
export function updateContact(user: GovernedUser, contactId: string, input: { value?: unknown; enabled?: unknown }): ContactView {
  const row = requireOwnContact(user, contactId);
  const changes: { value?: string; normalizedValue?: string; enabled?: boolean } = {};

  if (input.value !== undefined) {
    const { value, normalizedValue } = normalizeContactValue(row.channel as ContactChannel, input.value);
    changes.value = value;
    changes.normalizedValue = normalizedValue;
  }
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') {
      throw new ContactValidationError('قيمة enabled يجب أن تكون true أو false.');
    }
    changes.enabled = input.enabled;
  }

  try {
    userContactRepository.update(contactId, changes);
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new DuplicateContactError('جهة الاتصال هذه مسجّلة بالفعل لهذا الحساب.');
    }
    throw err;
  }
  return toView(userContactRepository.findById(contactId)!);
}

export function deleteContact(user: GovernedUser, contactId: string): void {
  requireOwnContact(user, contactId);
  userContactRepository.delete(contactId);
}
