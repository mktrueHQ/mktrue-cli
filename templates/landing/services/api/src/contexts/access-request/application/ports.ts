import type { AccessRequest, AccessRequestStatus } from "../domain/access-request";
import type { VerificationCode } from "../domain/verification-code";

export interface SendVerificationCodeInput {
  readonly to: string;
  readonly code: string;
}

export interface DeliverAccessRequestInput {
  readonly request: AccessRequest;
  /** __MKTRUE_OWNER__'s address, from env. **Never client-influenced** — that would be an open relay. */
  readonly to: string;
}

/** Outbound email — the only side effect this context performs. */
export interface Mailer {
  sendVerificationCode(input: SendVerificationCodeInput): Promise<void>;
  deliverAccessRequest(input: DeliverAccessRequestInput): Promise<void>;
}

/** Injectable wall-clock, so expiry can be tested without waiting fifteen minutes. */
export interface Clock {
  now(): Date;
}

/** Injectable code source, so a use case can be tested against a known code. */
export interface CodeGenerator {
  generate(): VerificationCode;
}

/**
 * The entire state of a pending access request — carried in the signed token, stored nowhere
 *. Only the code's **hash** is here.
 */
export interface AccessRequestTokenPayload {
  readonly request: { readonly email: string; readonly note?: string };
  readonly codeHash: string;
  /** Expiry, epoch milliseconds. */
  readonly exp: number;
}

/** Stateless HMAC sign/verify — the token *is* the state; no Redis, no pending collection. */
export interface TokenSigner {
  sign(payload: AccessRequestTokenPayload): string;
  /** `null` for a missing, malformed, or tampered-with token — the three are indistinguishable. */
  verify(token: string): AccessRequestTokenPayload | null;
  /**
   * A one-way digest of the whole token, which is how a replay is recognised.
   *
   * **Of the token, never of `codeHash`.** That hash is a salt-free SHA-256 of six digits, so
   * storing it beside an address would put a trivially reversible value in the mailbox — and two
   * independent requests draw the same six digits once in a million, which would silently swallow a
   * genuine second request in the one path where silence is worst. The token carries a millisecond
   * `exp`, so its digest collides never in practice and reverses to nothing.
   *
   * **Never the token itself.** Until `exp` a token is a bearer credential; a digest is not.
   */
  digest(token: string): string;
}

export interface StoredAccessRequest {
  readonly id: string;
  readonly email: string;
  readonly note?: string;
  readonly requestedAt: Date;
  readonly status: AccessRequestStatus;
}

/** What a claim answers: whether this verification is ours to act on, and what it created. */
export interface VerificationClaim {
  /** `false` when the row already held this digest — a replay, which must send nothing. */
  readonly claimed: boolean;
  /** `true` when the claim inserted the row, so releasing it means removing that row again. */
  readonly createdRow: boolean;
}

/**
 * The mailbox. Written **only** after verification.
 *
 * The row is keyed on the address, so the mailbox stays one row per person: a second request
 * updates `requestedAt` and the note rather than inserting a duplicate.
 *
 * **The claim is one atomic write, and it happens before the mail**. Reading a marker, then
 * mailing, then writing the marker leaves the entire mail round trip open: N concurrent verifies of
 * the same token all observe "not recorded", all deliver, and all write the same digest afterwards.
 * A single document update closes that window, and its **pre-image is the decision** — a pre-image
 * already holding this digest means the mail went out the first time.
 *
 * None of this is pending state: nothing is written before the code comes back, so an earlier decision stands.
 */
export interface AccessRequestRepository {
  /**
   * Record this verification, and say whether it was already recorded, in one write.
   *
   * `keepDigests` caps what the row remembers — `$push` with a negative `$slice`, so the list
   * cannot grow without bound and needs no sweeper. It is a **memory size**, `verificationMemory`
   * from the config, sized so that no token which might still be alive can be evicted and claimed
   * again. A database knows nothing about how long a token lives, which is why the number
   * arrives from outside.
   */
  claimVerification(
    request: AccessRequest,
    requestedAt: Date,
    tokenDigest: string,
    keepDigests: number,
  ): Promise<VerificationClaim>;

  /**
   * Undo a claim whose delivery then failed, so a retry can still reach __MKTRUE_OWNER__.
   *
   * The digest goes back, or the token would be spent on a mail nobody received. `createdRow` comes
   * from the claim's pre-image: a row this claim inserted and then never mailed about is exactly the
   * "stored, but nobody was told" state the old ordering existed to avoid, so it goes too — but only
   * while no other claim is holding it.
   *
   * **A row that already existed keeps its refreshed `requestedAt`, and that is a real edge.** The
   * claim moves the timestamp forward before the mail is attempted, and this does not put it back:
   * restoring a stale pre-image could undo a concurrent verification that did deliver. So a row can
   * carry a timestamp from a verification __MKTRUE_OWNER__ was never told about.
   */
  releaseVerification(email: string, tokenDigest: string, createdRow: boolean): Promise<void>;

  list(): Promise<readonly StoredAccessRequest[]>;
}

/**
 * Minimal logging seam, so a use case can report a failure without importing Fastify's logger.
 *
 * The signature takes a `code`, not a message built at the call site, precisely so nobody can slip
 * an address into it (CLAUDE.md §4.3).
 */
export interface Logger {
  error(code: string, error: unknown): void;
}

/**
 * A durable, instance-wide ceiling on outbound mail per day.
 *
 * **Why this exists alongside the per-IP rate limit.** The limiter caps one address at 5 starts an
 * hour; it says nothing about the total. Across enough addresses the daily volume is unbounded, and
 * the mail provider's quota is per *account* — shared with anything else sending from it. So the
 * failure this prevents is not "someone spams the mailbox", it is "the landing page silently
 * exhausts a quota something else depends on".
 *
 * **Durable, not in-memory.** An in-process counter resets on every restart, and a redeploy is
 * neither rare nor hard to provoke — it would hand back a fresh budget exactly when the cap
 * mattered. One small document is the price of a ceiling that survives.
 */
export interface SendBudget {
  /**
   * Counts `cost` units against `day`'s budget and answers whether it was within `limit`.
   *
   * **Increments first, then judges.** Check-then-increment races: two concurrent requests both
   * read 39, both send, and the cap is 41. Incrementing atomically and comparing the result cannot
   * over-send — at worst it over-counts a refused attempt, which errs toward sending less.
   *
   * **`cost` is how mail that is committed to but not yet sent gets paid for.** `start` reserves
   * two: the code mail it sends now, and the delivery its verification will send later.
   * `verify` never calls this at all — its mail was bought fifteen minutes earlier, which is what
   * keeps someone who has just proved they own an address from being stranded mid-flow.
   */
  reserve(day: string, limit: number, cost: number): Promise<boolean>;
}
