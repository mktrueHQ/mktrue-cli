import { Resend } from "resend";

import { deliveredAccessRequestEmail, verificationCodeEmail } from "./email-templates";
import type { Mailer } from "../application/ports";

/** Raised when mail is unconfigured. Mapped to 503 — never swallowed (CLAUDE.md §4.5). */
export class MailDeliveryFailed extends Error {
  constructor(reason: string) {
    // The reason is the provider's own message — never the recipient, which would put an address
    // into the log line this error eventually becomes (CLAUDE.md §4.3).
    super(`outbound mail failed: ${reason}`);
    this.name = "MailDeliveryFailed";
  }
}

export class MailerNotConfigured extends Error {
  constructor() {
    super("outbound mail is not configured");
    this.name = "MailerNotConfigured";
  }
}

export function createResendMailer(apiKey: string, from: string): Mailer {
  const resend = new Resend(apiKey);

  const send = async (to: string, mail: { subject: string; html: string; text: string }) => {
    const { error } = await resend.emails.send({ from, to, ...mail });
    // Resend reports failures in the payload rather than throwing. This is its own error type
    // rather than a bare `Error` so the controller can answer 503 instead of falling through to a
    // 500: a provider that rejected our key is an availability problem, and telling the requester
    // their address looks wrong — which is what an unmapped error made the form say — is a lie
    // about whose fault it is.
    if (error) throw new MailDeliveryFailed(error.message);
  };

  return {
    sendVerificationCode: ({ to, code }) => send(to, verificationCodeEmail(code)),
    deliverAccessRequest: ({ request, to }) =>
      send(to, deliveredAccessRequestEmail(request, new Date())),
  };
}

/**
 * Development only. Prints the code so the flow can be walked end to end without a mail provider.
 *
 * `server.ts` selects this **only** when `NODE_ENV !== "production"`. In production an unconfigured
 * key must reach `nullMailer` and refuse, never this — a "sent" that went to stdout is a request
 * lost behind a success message.
 */
export const consoleMailer: Mailer = {
  async sendVerificationCode({ to, code }) {
    console.info(`[dev mail] verification code for ${to}: ${code}`);
  },
  async deliverAccessRequest({ request }) {
    console.info(`[dev mail] access request from ${request.email}`);
  },
};

/**
 * Fail closed. Selected in production when `RESEND_API_KEY` is blank: every call refuses, so the
 * route answers 503 and the requester is told to try later — instead of being thanked for a
 * message that went nowhere.
 */
export const nullMailer: Mailer = {
  async sendVerificationCode() {
    throw new MailerNotConfigured();
  },
  async deliverAccessRequest() {
    throw new MailerNotConfigured();
  },
};
