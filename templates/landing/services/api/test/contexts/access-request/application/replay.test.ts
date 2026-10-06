import { describe, expect, it } from "vitest";

import { unavailableRepository } from "../../../test-support/fakes";
import { AT, CODE, EMAIL, harness } from "../../../test-support/harness";

/**
 * What a replayed verification may and may not do. Split from `flow.test.ts` because the
 * two together ran past the file length CLAUDE.md §5 asks for, and because these are one subject:
 * the mail __MKTRUE_OWNER__ receives happens once per token, whatever the caller does.
 */
describe("replaying a verification", () => {
  it("makes a replayed token a no-op: no second mail, no second write", async () => {
    // It is a no-op rather than a cheaper write: `requestedAt` is not refreshed and `status` is not
    // touched, so a row __MKTRUE_OWNER__ has already acted on cannot be walked backwards by replaying a token.
    const h = harness();
    const token = await h.start();
    await h.verify(token, CODE);

    const stored = h.rows.get(EMAIL);
    if (stored === undefined) throw new Error("the first verification stored nothing");
    h.rows.set(EMAIL, { ...stored, status: "approved" });
    h.clock.set(new Date(AT.getTime() + 60_000));

    await h.verify(token, CODE);

    expect(h.delivered()).toHaveLength(1);
    expect(h.rows.size).toBe(1);
    expect(h.rows.get(EMAIL)?.requestedAt).toEqual(AT);
    expect(h.rows.get(EMAIL)?.status).toBe("approved");
  });

  it("still answers success on a replay rather than an error", async () => {
    // Idempotent, not refused. The requester did everything asked of them, and a different answer
    // for a used token would tell a stranger whether that token had been used.
    const h = harness();
    const token = await h.start();
    await h.verify(token, CODE);

    await expect(h.verify(token, CODE)).resolves.toBeUndefined();
  });

  it("delivers once when the same token is verified concurrently", async () => {
    // **The test the sequential ones could not fail.** Read-then-mail-then-write left the whole mail
    // round trip open: every one of these observes "not recorded", every one delivers, and all of
    // them write the same digest afterwards. One start would have bought as many mails as a caller
    // could open sockets. The claim is a single atomic write, so exactly one of these wins it.
    const h = harness();
    const token = await h.start();

    await Promise.all(Array.from({ length: 8 }, () => h.verify(token, CODE)));

    expect(h.delivered()).toHaveLength(1);
    expect(h.rows.size).toBe(1);
  });

  it("delivers again for a genuine second request with a new token", async () => {
    // The test that protects what the fix could break. Both tokens carry the same address and, with
    // a fixed code generator, the same code; only `exp` differs. That is precisely why the marker
    // is a digest of the whole token: a marker made from the code would make these two requests
    // indistinguishable and silently swallow the second one.
    const h = harness();
    await h.verify(await h.start(), CODE);

    const later = new Date(AT.getTime() + 60_000);
    h.clock.set(later);
    await h.verify(await h.start(), CODE);

    expect(h.delivered()).toHaveLength(2);
    expect(h.rows.size).toBe(1);
    expect(h.rows.get(EMAIL)?.requestedAt).toEqual(later);
  });

  it("delivers nothing extra when two live tokens are alternated", async () => {
    // **The cycling hole, closed.** A row that remembered one digest was defeated at zero cost: two
    // live tokens for one address always mismatched the other's marker, so every verify delivered.
    // Two tokens against this harness's memory of five is the small case; the test below crosses
    // midnight UTC, which is where the size of that memory is actually decided.
    const h = harness();
    const first = await h.start();
    h.clock.set(new Date(AT.getTime() + 60_000));
    const second = await h.start();

    await h.verify(first, CODE);
    await h.verify(second, CODE);
    await h.verify(first, CODE);
    await h.verify(second, CODE);

    expect(h.delivered()).toHaveLength(2);
  });

  it("remembers both days' tokens when a token's life straddles midnight UTC", async () => {
    // **The constant, tested rather than asserted — and the test that was missing.** `SendBudget`'s
    // key resets at midnight, so a caller can take one day's entire budget in its final quarter of
    // an hour and the next day's the moment it resets, and every one of those tokens is still
    // alive. Sized for one day's issuance the row would evict the oldest here, and an evicted token
    // claims again and mails again. `verificationMemory` is `dailySendLimit + 1` precisely because
    // a fifteen-minute window touches two UTC days, whose combined issuance is at most the limit.
    const h = harness();
    // A distinct minute per start, because the clock is fixed: two starts in the same instant sign
    // the same payload and so mint the *same* token, which would quietly turn this into a replay
    // test with two tokens instead of a memory test with four.
    const startAt = async (instant: string) => {
      h.clock.set(new Date(instant));
      return h.start();
    };

    const dayOne = [
      await startAt("2026-09-09T23:50:00.000Z"),
      await startAt("2026-09-09T23:55:00.000Z"),
    ];
    const dayTwo = [
      await startAt("2026-09-10T00:01:00.000Z"),
      await startAt("2026-09-10T00:02:00.000Z"),
    ];
    // All four are inside their fifteen minutes at 00:02, and they span two budget days.
    const live = [...dayOne, ...dayTwo];

    for (const token of live) await h.verify(token, CODE);
    // Oldest first, which is the order that evicts if the memory is a slot short.
    for (const token of live) await h.verify(token, CODE);

    expect(h.delivered()).toHaveLength(live.length);
  });

  it("re-delivers when the mailbox is unavailable, rather than refusing", async () => {
    // Fail open, deliberately: with no database there is no claim to make, and the requester has
    // just proved the address is theirs. The blast radius is the fifteen minutes of tokens already
    // issued, because a Mongo that cannot be claimed against cannot reserve budget either, so
    // `start` is handing out none.
    const h = harness({ repository: unavailableRepository() });
    const token = await h.start();

    await h.verify(token, CODE);
    await h.verify(token, CODE);

    expect(h.delivered()).toHaveLength(2);
  });

  it("releases the claim when the delivery fails, so the token is not spent", async () => {
    // The failure the new ordering introduces, and the reason the claim carries its pre-image. The
    // row this claim created goes with it: a row nobody was told about is the "quietly never
    // happened" case the old mail-first ordering existed to avoid.
    const h = harness({ deliveryFails: new Error("resend is down") });
    const token = await h.start();

    await expect(h.verify(token, CODE)).rejects.toThrow(/resend/);

    expect(h.rows.size).toBe(0);
    // Not spent: the second attempt claims again and reaches the mailer, rather than returning
    // early as a replay would.
    await expect(h.verify(token, CODE)).rejects.toThrow(/resend/);
  });

  it("reports a failed claim by its code, and builds no message of its own", async () => {
    // The seam takes a fixed code precisely so a caller cannot slip an address into it. What the
    // *error object* carries is cut down to a name and a code one layer out, in `safeErrorSummary`
    // — proved end to end in `test/controllers/logging.test.ts`.
    const h = harness({
      repository: unavailableRepository(
        new Error('dup key: { email: "marta@example.com" } while claiming'),
      ),
    });
    const token = await h.start();

    await h.verify(token, CODE);

    expect(h.lines.map((line) => line.code)).toEqual(["access_request.claim_failed"]);
    expect(h.delivered()).toHaveLength(1);
  });
});
