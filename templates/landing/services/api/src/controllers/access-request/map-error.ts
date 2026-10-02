import type { FastifyReply } from "fastify";

import {
  DailySendLimitReached,
  InvalidAccessRequest,
  InvalidVerificationCode,
  InvalidVerificationToken,
  VerificationExpired,
} from "../../contexts/access-request/domain/errors";
import {
  MailDeliveryFailed,
  MailerNotConfigured,
} from "../../contexts/access-request/infrastructure/mailers";

/**
 * Domain errors to status codes.
 *
 * **Every branch returns a fixed string.** No error message, no field value and above all no email
 * address reaches the client (CLAUDE.md §4.3) — the envelope is a code the page maps to its own
 * copy, so an error can never become a channel for echoing back what was submitted.
 *
 * A wrong code and an expired one answer the **same** 400 with the same body. Distinguishing them
 * tells an attacker whether a token is still live, which is a small oracle that costs nothing to
 * close.
 */
export function mapAccessRequestError(error: unknown, reply: FastifyReply) {
  if (error instanceof InvalidAccessRequest) {
    return reply.status(400).send({ error: "invalid_request" });
  }

  if (
    error instanceof InvalidVerificationCode ||
    error instanceof VerificationExpired ||
    error instanceof InvalidVerificationToken
  ) {
    return reply.status(400).send({ error: "invalid_code" });
  }

  if (
    error instanceof MailerNotConfigured ||
    error instanceof MailDeliveryFailed ||
    error instanceof DailySendLimitReached
  ) {
    // Fail closed, and say so honestly: the requester should try later, not assume it worked.
    // Unconfigured, provider-rejected and quota-exhausted share this answer deliberately — from
    // where the requester stands they are the same event, none of them is their fault, and the
    // difference is ours to read in the logs — **except where it is not**. an earlier decision carries a dated
    // qualification for that: a Mongo fault inside `SendBudget.reserve` answers `false` without
    // logging, and neither mailer failure is logged on this path either, so three of these four
    // branches can reach a requester with nothing written down. A logger on that seam is the
    // follow-up. Notably NOT 429: that would blame the caller for a
    // ceiling every other caller helped reach, and "try again in an hour" would be a lie.
    return reply.status(503).send({ error: "mail_unavailable" });
  }

  throw error;
}
