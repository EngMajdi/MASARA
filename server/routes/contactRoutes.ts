import { Router } from 'express';
import { requireAuthenticatedUser } from '../services/authz';
import {
  listContactsForUser,
  createContact,
  updateContact,
  deleteContact,
  ContactNotFoundError,
  ContactAccessDeniedError,
  DuplicateContactError,
  ContactValidationError,
} from '../services/UserContactService';
import {
  requestVerification,
  confirmVerification,
  ContactDisabledError,
  VerificationUnavailableError,
  InvalidVerificationCodeError,
} from '../services/ContactVerificationService';

// Phase 6A — Identity & Contact Foundation API. Self-service only: the
// authenticated caller manages their OWN contacts, resolved entirely from
// their session email (requireAuthenticatedUser) — never from a
// client-supplied userId/studentId/journeyId/tripId/notificationId (spec
// §14/§15). Kept minimal (spec §10/§20): no admin-scoped management
// endpoint exists — nothing in this phase demonstrated a genuine need for
// one, and "keep the API minimal" / "do not create a generic admin
// mutation API unless genuinely needed" both argue against building one
// speculatively.
export const contactRouter = Router();

function handleContactError(err: unknown, res: import('express').Response) {
  if (err instanceof ContactNotFoundError) return res.status(404).json({ error: err.message });
  if (err instanceof ContactAccessDeniedError) return res.status(403).json({ error: err.message });
  if (err instanceof DuplicateContactError) return res.status(409).json({ error: err.message });
  if (err instanceof ContactValidationError) return res.status(422).json({ error: err.message });
  console.error('Contact error:', err);
  return res.status(500).json({ error: 'حدث خطأ غير متوقع أثناء معالجة جهة الاتصال.' });
}

function handleVerificationError(err: unknown, res: import('express').Response) {
  if (err instanceof ContactNotFoundError) return res.status(404).json({ error: err.message });
  if (err instanceof ContactAccessDeniedError) return res.status(403).json({ error: err.message });
  if (err instanceof ContactDisabledError) return res.status(409).json({ error: err.message });
  if (err instanceof VerificationUnavailableError) return res.status(409).json({ error: err.message });
  if (err instanceof InvalidVerificationCodeError) return res.status(422).json({ error: err.message });
  console.error('Contact verification error:', err);
  return res.status(500).json({ error: 'حدث خطأ غير متوقع أثناء توثيق جهة الاتصال.' });
}

contactRouter.get('/api/me/contacts', (req, res) => {
  const guard = requireAuthenticatedUser(req.query.userEmail);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  res.json(listContactsForUser(guard.user));
});

contactRouter.post('/api/me/contacts', (req, res) => {
  const guard = requireAuthenticatedUser(req.body?.userEmail);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  try {
    res.status(201).json(createContact(guard.user, { channel: req.body?.channel, value: req.body?.value }));
  } catch (err) {
    handleContactError(err, res);
  }
});

contactRouter.patch('/api/me/contacts/:id', (req, res) => {
  const guard = requireAuthenticatedUser(req.body?.userEmail);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  try {
    res.json(updateContact(guard.user, req.params.id, { value: req.body?.value, enabled: req.body?.enabled }));
  } catch (err) {
    handleContactError(err, res);
  }
});

contactRouter.delete('/api/me/contacts/:id', (req, res) => {
  const guard = requireAuthenticatedUser(req.body?.userEmail);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  try {
    deleteContact(guard.user, req.params.id);
    res.json({ success: true });
  } catch (err) {
    handleContactError(err, res);
  }
});

// Phase 6B — the verification boundary. Self-service only, same
// ownership re-derivation as every other route above: the caller's own
// contact, resolved from their session email, never from a client-
// supplied id/userId. Neither route ever returns a raw code or contact
// value — request returns a non-delivery status DTO, confirm returns the
// same masked ContactView every other mutation already returns.
contactRouter.post('/api/me/contacts/:id/verify/request', (req, res) => {
  const guard = requireAuthenticatedUser(req.body?.userEmail);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  try {
    res.status(202).json(requestVerification(guard.user, req.params.id));
  } catch (err) {
    handleVerificationError(err, res);
  }
});

contactRouter.post('/api/me/contacts/:id/verify/confirm', (req, res) => {
  const guard = requireAuthenticatedUser(req.body?.userEmail);
  if (guard.ok === false) return res.status(guard.status).json({ error: guard.error });
  try {
    res.json(confirmVerification(guard.user, req.params.id, req.body?.code));
  } catch (err) {
    handleVerificationError(err, res);
  }
});
