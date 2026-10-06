import { AccessRequest } from "../domain/access-request";
import {
  InvalidVerificationCode,
  InvalidVerificationToken,
  VerificationExpired,
} from "../domain/errors";
import { VerificationCode } from "../domain/verification-code";

import type {
  AccessRequestRepository,
  Clock,
  Logger,
  Mailer,
  TokenSigner,
  VerificationClaim,
  WrongCodeCounter,
} from "./ports";

export interface VerifyAccessRequestInput {
  readonly token: string;
  readonly code: string;
}

export interface VerifyAccessRequestDeps {
  readonly mailer: Mailer;
  readonly tokenSigner: TokenSigner;
  readonly clock: Clock;
  readonly repository: AccessRequestRepository;
  readonly logger: Logger;
  readonly destinationEmail: string;
  /**
   * How many token digests the row remembers — `config.verificationMemory`, which is where the
   * sizing and its proof live. A memory size, deliberately, not a mail budget.
   */
  readonly verificationMemory: number;
  readonly wrongCodes: WrongCodeCounter;
}

/** The wrong codes one token may be sent. The next verification of it is refused, right or wrong. */
export const MAX_WRONG_CODES = 5;

/**
 * Step 2: check the code against the token, then deliver the request to __MKTRUE_OWNER__ and store it.
 *
 * **Verified is not approved**. This function's success means one thing only — the
 * requester can receive mail at that address. It grants nothing, and there is nothing here it
 * could grant: this service has no connection to __MKTRUE_TITLE__ at all.
 *
 * **The claim comes before the mail, which inverts the ordering this function used to argue for,
 * so here is the argument it replaces**. The old order mailed first and wrote afterwards,
 * on the reasoning that a stored row nobody was told about is a request that quietly never
 * happened, while an address that reached __MKTRUE_OWNER__'s inbox is a request he can honour with no row at
 * all. That reasoning was right about priorities and wrong about its window: between the read and
 * the write sat an entire Resend round trip, and N concurrent verifies of one token all read "not
 * recorded" inside it, so the marker bounded nothing that was actually in a hurry.
 *
 * Both properties the old order protected are kept, by other means:
 *
 * - **Mail even when the database is gone.** If the claim itself throws, this fails open: the
 *   failure is logged by code and the delivery goes anyway. `MONGO_URI` is deliberately absent from
 *   the production gate, so no database is a supported mode, and it must not become a wall in front
 *   of someone who has just proved they own an address.
 * - **Never a row nobody was told about.** If the claim succeeds and the delivery then fails, the
 *   claim is released: the digest goes back so a retry still delivers, and a row this claim created
 *   is removed again. The pre-image is what makes that precise rather than a guess. **Release is not
 *   free**, and the cost is worth naming: if Resend accepted the send and the call then timed out,
 *   un-spending the token means a retry produces a genuine second delivery. One duplicate mail to
 *   __MKTRUE_OWNER__ is the better side of that trade than a request that reached nobody, but it is a trade.
 *
 * **A replay returns early, and that early return is a success.** The mail was delivered and the row
 * written the first time, so there is nothing left to do. An error would be untrue — the requester
 * did everything asked of them — and it would tell a stranger whether a token had been used. Status
 * and body are byte-identical to a first verification; the one difference a caller could measure is
 * latency, because a replay skips the Resend round trip.
 */
export async function verifyAccessRequest(
  input: VerifyAccessRequestInput,
  deps: VerifyAccessRequestDeps,
): Promise<void> {
  const payload = deps.tokenSigner.verify(input.token);
  if (payload === null) throw new InvalidVerificationToken();

  // Server-side, against an injected clock — never a client-supplied timestamp.
  const now = deps.clock.now().getTime();
  if (payload.exp <= now) throw new VerificationExpired();

  // A token that has had its wrong codes is dead, and answers as an expired one does: the right
  // code is refused too, or the sixth guess would be as good as the first.
  const tokenDigest = deps.tokenSigner.digest(input.token);
  if (deps.wrongCodes.isSpent(tokenDigest, MAX_WRONG_CODES, now)) throw new VerificationExpired();

  const code = VerificationCode.of(input.code);
  if (!deps.tokenSigner.codeMatches(code.value, payload)) {
    deps.wrongCodes.record(tokenDigest, payload.exp);
    throw new InvalidVerificationCode();
  }

  // Rebuilt through the domain rather than trusted off the token: the HMAC proves we issued the
  // payload, not that our own validation was correct when we did.
  const request = AccessRequest.create(payload.request);

  const claim = await claimOrFailOpen(request, tokenDigest, deps);

  // The pre-image is the decision: it already held this digest, so the mail went the first time.
  if (claim !== null && !claim.claimed) return;

  try {
    await deps.mailer.deliverAccessRequest({ request, to: deps.destinationEmail });
  } catch (error) {
    if (claim !== null) await releaseClaim(request.email, tokenDigest, claim, deps);
    throw error;
  }
}

/**
 * `null` when the mailbox could not be asked at all, which is a **deliberate fail-open**.
 *
 * The blast radius is bounded **when Mongo is unreachable**, which is the mode this argues for:
 * `SendBudget.reserve` fails the same way, so `start` issues no new tokens, and the only tokens that
 * can reach this branch are the ones already out, each alive for at most fifteen minutes. Both
 * writes carry the same short `maxTimeMS`, so a slow-but-connected database degrades on both sides
 * together rather than leaving issuance on while replay protection is off. Two limits on that
 * claim, both real: `maxTimeMS` bounds execution and not **server selection**, so a primary
 * election stalls both writes for the driver's default rather than briefly; and nothing
 * here can bound a database that serves the budget write while refusing this one.
 *
 * Set against that, failing closed would refuse people who have just proved they own their address,
 * for the duration of an outage, and lose the request entirely — nothing about it is stored until
 * this point.
 *
 * The failure is reported as a fixed code. Of the error object itself the adapter
 * (`safeErrorSummary`) logs the name and the code, never the message, which is where a Mongo error
 * quotes an address or a digest (CLAUDE.md §4.3).
 */
async function claimOrFailOpen(
  request: AccessRequest,
  tokenDigest: string,
  deps: VerifyAccessRequestDeps,
): Promise<VerificationClaim | null> {
  try {
    return await deps.repository.claimVerification(
      request,
      deps.clock.now(),
      tokenDigest,
      deps.verificationMemory,
    );
  } catch (error) {
    deps.logger.error("access_request.claim_failed", error);
    return null;
  }
}

/**
 * A failed release is logged rather than surfaced: the caller is already handling a failed
 * delivery, and replacing that error with this one would tell the requester the wrong thing. The
 * cost of it failing is that one token stays spent — the requester starts again, which is what the
 * 503 they are about to receive already asks of them.
 */
async function releaseClaim(
  email: string,
  tokenDigest: string,
  claim: VerificationClaim,
  deps: VerifyAccessRequestDeps,
): Promise<void> {
  try {
    await deps.repository.releaseVerification(email, tokenDigest, claim.createdRow);
  } catch (error) {
    deps.logger.error("access_request.release_failed", error);
  }
}
