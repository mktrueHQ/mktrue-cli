import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AccessRequest } from "../../../../src/contexts/access-request/domain/access-request";
import { AccessRequestModel } from "../../../../src/contexts/access-request/infrastructure/access-request-model";
import { mongooseAccessRequestRepository as repository } from "../../../../src/contexts/access-request/infrastructure/mongoose-access-request-repository";

/**
 * The first test either Mongo adapter has had, written for the queries an earlier decision adds.
 *
 * It runs against a real mongod rather than the fake because both properties at stake are the
 * database's own. One is a *mongoose* rule: unknown paths are stripped on write, so digests pushed
 * without a schema entry disappear silently and every replay check answers false. The other is
 * atomicity — the claim is one document update precisely so concurrent verifies of a token cannot
 * all decide they are the first, and no in-process fake can prove that about MongoDB.
 */
const AT = new Date("2026-09-13T21:04:00.000Z");
const LATER = new Date("2026-09-13T21:09:00.000Z");
const EMAIL = "marta@example.com";
const DIGEST = "a".repeat(64);
const OTHER_DIGEST = "b".repeat(64);
const THIRD_DIGEST = "c".repeat(64);
const KEEP = 3;

const request = AccessRequest.create({ email: EMAIL, note: "I want to see the undo log." });

describe("the mongoose access-request repository", () => {
  let memoryServer: MongoMemoryServer;

  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri(), { dbName: "__MKTRUE_NAME__-test" });

    // **Wait for the unique index, or this suite proves nothing.** Mongoose builds indexes
    // asynchronously *after* connecting, and `claimVerification` reads a duplicate key on `email` as
    // "already recorded" — so until that index exists a replay does not collide, it simply inserts a
    // second row and answers `claimed: true`. The only `init()` in this file used to sit inside the
    // index test at the bottom, three tests after the first one that depends on it.
    //
    // Measured rather than reasoned: without this line the first test failed 4 runs in 6 against a
    // fresh mongod, each time with **two rows for one address**. It is also why CI failed on
    // `4d451ff` and passed on `6810f89` — two commits whose only difference was prose.
    await AccessRequestModel.init();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer.stop();
  });

  beforeEach(async () => {
    await AccessRequestModel.deleteMany({});
  });

  it("claims a verification once, and answers the same token a second time with no claim", async () => {
    const first = await repository.claimVerification(request, AT, DIGEST, KEEP);
    const replay = await repository.claimVerification(request, LATER, DIGEST, KEEP);

    expect(first).toEqual({ claimed: true, createdRow: true });
    expect(replay).toEqual({ claimed: false, createdRow: false });
  });

  it("claims exactly once when the same token is claimed concurrently", async () => {
    // The blocker this ordering exists to close, against the real database rather than a fake: with
    // the claim after the mail, every one of these would have been told it was the first.
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => repository.claimVerification(request, AT, DIGEST, KEEP)),
    );

    expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
    expect(claims.filter((claim) => claim.createdRow)).toHaveLength(1);
    await expect(AccessRequestModel.countDocuments({})).resolves.toBe(1);
  });

  it("leaves the row untouched on a replay", async () => {
    // A replay must be a no-op, not a cheaper write: the filter excludes rows already holding the
    // digest, so a forgotten note cannot overwrite a newer one and the timestamp cannot move.
    await repository.claimVerification(request, AT, DIGEST, KEEP);
    const second = AccessRequest.create({ email: EMAIL, note: "an older note" });

    await repository.claimVerification(second, LATER, DIGEST, KEEP);

    const [stored] = await repository.list();
    expect(stored?.requestedAt).toEqual(AT);
    expect(stored?.note).toBe("I want to see the undo log.");
  });

  it("remembers every digest inside the cap, so an older token is still recognised", async () => {
    await repository.claimVerification(request, AT, DIGEST, KEEP);
    await repository.claimVerification(request, LATER, OTHER_DIGEST, KEEP);
    await repository.claimVerification(request, LATER, THIRD_DIGEST, KEEP);

    // All three are inside a cap of three: none of them can be replayed for another delivery.
    for (const digest of [DIGEST, OTHER_DIGEST, THIRD_DIGEST]) {
      await expect(repository.claimVerification(request, LATER, digest, KEEP)).resolves.toEqual({
        claimed: false,
        createdRow: false,
      });
    }
  });

  it("re-opens an evicted token, which is the hole the memory size exists to prevent", async () => {
    // **Demonstrating the failure, not reassuring about it.** Cycle one more live token than the row
    // can remember and the oldest falls out; claiming it again is another delivery, and claiming it
    // evicts the next, so the cycle never ends. That is why `verificationMemory` is sized to exceed
    // every token that can be alive at once rather than to a day's issuance — a cap of two
    // makes it reachable in three claims here.
    await repository.claimVerification(request, AT, DIGEST, 2);
    await repository.claimVerification(request, LATER, OTHER_DIGEST, 2);
    await repository.claimVerification(request, LATER, THIRD_DIGEST, 2);

    // The first digest was evicted, so it claims again — one more mail than the ceiling promised.
    await expect(repository.claimVerification(request, LATER, DIGEST, 2)).resolves.toEqual({
      claimed: true,
      createdRow: false,
    });
    // And that claim evicted the second, so the cycle continues rather than settling.
    await expect(
      repository.claimVerification(request, LATER, OTHER_DIGEST, 2),
    ).resolves.toMatchObject({ claimed: true });
  });

  it("claims exactly once when the same token races against a row that already exists", async () => {
    // Both other concurrency cases start from an empty collection; a live mailbox is almost always
    // in this state, and it takes the update path rather than the insert-and-collide one.
    await repository.claimVerification(request, AT, OTHER_DIGEST, KEEP);

    const claims = await Promise.all(
      Array.from({ length: 8 }, () => repository.claimVerification(request, LATER, DIGEST, KEEP)),
    );

    expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
    expect(claims.every((claim) => !claim.createdRow)).toBe(true);
    await expect(AccessRequestModel.countDocuments({})).resolves.toBe(1);
  });

  it("carries exactly one unique index, on the address", async () => {
    // The claim's duplicate-key branch reads `keyPattern.email` to mean "a row for this person
    // exists". A second unique index would make some other collision look like that, and a genuine
    // claim would answer "already recorded" — no mail, no row, `200 verified`. This fails the build
    // instead.
    await AccessRequestModel.init();
    const indexes = await AccessRequestModel.collection.indexes();

    expect(indexes.filter((index) => index.unique === true).map((index) => index.key)).toEqual([
      { email: 1 },
    ]);
  });

  it("treats a row written before the digests existed as carrying no verification", async () => {
    // Rows written by the old code have no such field. They must keep working and simply match no
    // replay — which is what makes a rollback past this commit safe (docs/deploy.md).
    await AccessRequestModel.create({ email: EMAIL, requestedAt: AT, status: "new" });

    await expect(repository.claimVerification(request, LATER, DIGEST, KEEP)).resolves.toEqual({
      claimed: true,
      createdRow: false,
    });
  });

  it("releases a claim, removing a row the claim created", async () => {
    const claim = await repository.claimVerification(request, AT, DIGEST, KEEP);

    await repository.releaseVerification(EMAIL, DIGEST, claim.createdRow);

    await expect(AccessRequestModel.countDocuments({})).resolves.toBe(0);
    // And the token is not spent: it can claim again, so a retry still reaches __MKTRUE_OWNER__.
    await expect(repository.claimVerification(request, LATER, DIGEST, KEEP)).resolves.toEqual({
      claimed: true,
      createdRow: true,
    });
  });

  it("keeps a row it did not create, and one another claim is still holding", async () => {
    await repository.claimVerification(request, AT, DIGEST, KEEP);
    const second = await repository.claimVerification(request, LATER, OTHER_DIGEST, KEEP);

    await repository.releaseVerification(EMAIL, OTHER_DIGEST, second.createdRow);

    await expect(AccessRequestModel.countDocuments({})).resolves.toBe(1);
    // The released token can claim again; the one still held cannot.
    await expect(
      repository.claimVerification(request, LATER, OTHER_DIGEST, KEEP),
    ).resolves.toMatchObject({ claimed: true });
    await expect(repository.claimVerification(request, LATER, DIGEST, KEEP)).resolves.toMatchObject(
      { claimed: false },
    );
  });

  it("keeps the digests out of every DTO it hands back", async () => {
    // An internal replay marker, not a field of the mailbox anyone reads.
    await repository.claimVerification(request, AT, DIGEST, KEEP);

    const [listed] = await repository.list();

    expect(listed).not.toHaveProperty("tokenDigests");
    expect(listed?.email).toBe(EMAIL);
  });
});
