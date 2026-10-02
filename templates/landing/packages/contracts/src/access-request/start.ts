import { z } from "zod";

/**
 * Body for `POST /access-request/start` — step 1 of the flow. The API mails a six-digit
 * code to `email` and returns a signed token. **It persists nothing**: an unverified request costs
 * one email and zero rows.
 *
 * 254 is the maximum length of an email address per RFC 5321, so it is a real bound rather than a
 * guessed one. The note is the only free text in the repo; 500 chars is enough to say why you want
 * in and short enough that the delivered mail stays readable on a phone.
 */
export const startAccessRequestBodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  note: z.string().trim().max(500).optional(),
});

export type StartAccessRequestBody = z.infer<typeof startAccessRequestBodySchema>;

/**
 * Response for step 1 — the stateless token carrying the pending request.
 *
 * Deliberately says nothing about whether the address is already known, already requested, or
 * already on the whitelist. Any difference here is an oracle for who has access to __MKTRUE_TITLE__.
 */
export const startAccessRequestResponseSchema = z.object({
  token: z.string().min(1),
});

export type StartAccessRequestResponse = z.infer<typeof startAccessRequestResponseSchema>;
