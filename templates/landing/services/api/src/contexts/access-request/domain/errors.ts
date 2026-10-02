/**
 * Domain errors. **None of them carries the requester's address, note, or any part of either**
 * (CLAUDE.md §4.3): these messages reach logs and, mapped, the client. An error that embeds the
 * address puts PII in both places at once.
 */
export class InvalidAccessRequest extends Error {
  constructor(readonly field: "email" | "note") {
    super(`access request rejected: ${field} is not valid`);
    this.name = "InvalidAccessRequest";
  }
}

export class InvalidVerificationCode extends Error {
  constructor() {
    super("the verification code does not match");
    this.name = "InvalidVerificationCode";
  }
}

export class VerificationExpired extends Error {
  constructor() {
    super("the verification token has expired");
    this.name = "VerificationExpired";
  }
}

/** A token that is missing, malformed, or tampered with — deliberately indistinguishable. */
export class InvalidVerificationToken extends Error {
  constructor() {
    super("the verification token is not valid");
    this.name = "InvalidVerificationToken";
  }
}

/**
 * The instance has sent as much mail today as it is allowed to.
 *
 * Not the requester's fault and not about their input, which is why it maps to an availability
 * response rather than a rejection — see `controllers/access-request/map-error.ts`.
 */
export class DailySendLimitReached extends Error {
  constructor(readonly limit: number) {
    super(`the daily outbound mail limit of ${limit} has been reached`);
    this.name = "DailySendLimitReached";
  }
}
