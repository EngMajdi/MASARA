// Phase 6A — Identity & Contact Foundation. A contact is CONFIGURATION data
// owned by an existing governed `users` row — never a second identity, never
// an operational event, never a notification (spec §17). This file is the
// single closed vocabulary every layer (service/route/tests) imports from —
// no file re-declares its own channel list.

export const CONTACT_CHANNELS = ['EMAIL', 'SMS', 'PUSH'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export function isValidContactChannel(value: unknown): value is ContactChannel {
  return typeof value === 'string' && (CONTACT_CHANNELS as readonly string[]).includes(value);
}

/**
 * The public, self-service read-model DTO. Deliberately excludes `value`
 * and `normalizedValue` (the raw address) — only `masked` is ever returned
 * (spec §6/§15: never expose a raw push token, never expose a full email/
 * phone unnecessarily). No userId either — ownership is implicit (this is
 * always "my own contact", never returned for anyone else, spec §14).
 */
export interface ContactView {
  id: string;
  channel: ContactChannel;
  masked: string;
  verified: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
