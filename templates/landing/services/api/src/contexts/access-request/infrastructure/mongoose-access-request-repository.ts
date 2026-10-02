import type { AccessRequest } from "../domain/access-request";
import { DEFAULT_DAILY_SEND_LIMIT } from "../application/start-access-request";
import type {
  AccessRequestRepository,
  StoredAccessRequest,
  VerificationClaim,
} from "../application/ports";
import { AccessRequestModel, type AccessRequestDocument } from "./access-request-model";

/** `tokenDigests` is deliberately not mapped: it is an internal replay marker, never a DTO field. */
function toStored(doc: AccessRequestDocument & { _id: unknown }): StoredAccessRequest {
  return {
    id: String(doc._id),
    email: doc.email,
    ...(doc.note ? { note: doc.note } : {}),
    requestedAt: doc.requestedAt,
    status: doc.status,
  };
}

/**
 * A server that accepted the command and then stalled, bounded. The schema bounds the other half,
 * the client-side buffering that happens when there is no connection at all.
 */
const WRITE_TIMEOUT_MS = 2_000;

/**
 * A duplicate key **on the address**, which is the only thing this adapter may read as "a row for
 * this person already exists".
 *
 * **Keyed on the index, not on the code alone.** Matching `11000` by itself silently widens the
 * moment anyone adds a second unique index: a genuine claim for a different address would come back
 * as "already recorded", so the requester gets `200 verified`, __MKTRUE_OWNER__ gets no mail and no row is
 * written. A mongod test asserts the collection's unique indexes are exactly `{ email: 1 }`, so
 * adding one fails the build rather than changing what this branch means.
 */
function isEmailDuplicateKey(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (!("code" in error) || error.code !== 11000) return false;
  if (!("keyPattern" in error)) return false;

  const keyPattern = error.keyPattern;
  if (typeof keyPattern !== "object" || keyPattern === null) return false;

  // Exactly one key, and that key is the address. A compound unique index cannot be misread as this
  // one whatever the index test says, so the test becomes belt-and-braces rather than the only
  // guard standing between a new index and a silently swallowed request.
  return Object.keys(keyPattern).length === 1 && "email" in keyPattern;
}

/**
 * A last guard on the memory size. `config.ts` refuses a `DAILY_SEND_LIMIT` that is not a positive
 * integer, so this can only fire if something bypasses it — and the failure it prevents is the
 * quietest in the slice: `$slice: -NaN` is accepted by mongod and stores an empty array, leaving
 * the marker off.
 *
 * **Sized from the default ceiling rather than written as a literal**, so that changing the default
 * is visibly a two-place edit. Be honest about what it is worth: this file cannot see the *configured*
 * limit, so against a raised `DAILY_SEND_LIMIT` this falls short rather than long. It is a floor
 * under a value that should never be wrong, not a substitute for one.
 */
const SAFE_MEMORY = DEFAULT_DAILY_SEND_LIMIT + 1;

export const mongooseAccessRequestRepository: AccessRequestRepository = {
  /**
   * One atomic write that both records the verification and reports whether it was already
   * recorded. The filter excludes rows already holding this digest, so a replay updates nothing —
   * it does not refresh `requestedAt`, and it cannot overwrite the note with an older one.
   *
   * **`status` is only set on insert** (`$setOnInsert`). If it were in `$set`, a returning requester
   * would silently reset a row __MKTRUE_OWNER__ had already marked `approved` or `declined`, quietly undoing
   * a decision he made by hand.
   */
  async claimVerification(
    request: AccessRequest,
    requestedAt: Date,
    tokenDigest: string,
    keepDigests: number,
  ): Promise<VerificationClaim> {
    const keep = Number.isInteger(keepDigests) && keepDigests > 0 ? keepDigests : SAFE_MEMORY;
    const filter = { email: request.email, tokenDigests: { $ne: tokenDigest } };
    const update = {
      $set: { note: request.note, requestedAt },
      $push: { tokenDigests: { $each: [tokenDigest], $slice: -keep } },
      $setOnInsert: { email: request.email, status: "new" },
    };

    try {
      const before = await AccessRequestModel.findOneAndUpdate(filter, update, {
        upsert: true,
        returnDocument: "before",
        setDefaultsOnInsert: true,
        maxTimeMS: WRITE_TIMEOUT_MS,
      }).lean();

      // No pre-image means this call inserted the row, which is what a release would have to undo.
      return { claimed: true, createdRow: before === null };
    } catch (error) {
      if (!isEmailDuplicateKey(error)) throw error;
    }

    // The unique index refused an insert, so a row for this address exists that the filter did not
    // match. Either it already holds this digest — a replay — or a verification of a *different*
    // token created it in the last millisecond, in which case this claim is still open and the
    // update path takes it. Distinguishing them matters: answering "replay" to a genuine second
    // request would swallow it in silence, which is the worst outcome this path has.
    const before = await AccessRequestModel.findOneAndUpdate(filter, update, {
      returnDocument: "before",
      maxTimeMS: WRITE_TIMEOUT_MS,
    }).lean();

    // `null` here means the row holds this digest — a replay — or that it vanished in the same
    // instant, which only a failed delivery's release does.
    //
    // **The second case loses the request entirely, and that is worth stating plainly**: no mail,
    // no row, and a `200 verified` on the way back, which is the "quietly never happened" state the
    // mail-first ordering existed to avoid. Reaching it needs a provider outage and a concurrent
    // verification of the same address in the same instant. It is left open because the fix is a
    // retry loop whose own failure mode — claiming twice and mailing twice — is worse.
    return { claimed: before !== null, createdRow: false };
  },

  async releaseVerification(email: string, tokenDigest: string, createdRow: boolean) {
    await AccessRequestModel.updateOne(
      { email },
      { $pull: { tokenDigests: tokenDigest } },
      { maxTimeMS: WRITE_TIMEOUT_MS },
    );

    if (!createdRow) return;

    // `$size: 0` is the guard, not an optimisation: a concurrent verification of another token may
    // have claimed this row and delivered successfully while this delivery was failing, and that
    // request must keep its row.
    await AccessRequestModel.deleteOne(
      { email, tokenDigests: { $size: 0 } },
      { maxTimeMS: WRITE_TIMEOUT_MS },
    );
  },

  async list() {
    const docs = await AccessRequestModel.find().sort({ requestedAt: -1 }).lean();
    return docs.map(toStored);
  },
};
