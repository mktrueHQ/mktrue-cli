import { describe, expect, it } from "vitest";

import { AT, CODE, DESTINATION, EMAIL, harness } from "../../../test-support/harness";

// The replay and idempotence tests live in `replay.test.ts`, beside this one.

describe("starting a request", () => {
  it("stores nothing at all", async () => {
    // The anti-spam design: an unverified request costs one email and zero rows.
    const h = harness();
    await h.start();

    expect(h.rows.size).toBe(0);
  });

  it("mails the code only to the address in the request", async () => {
    // There is no parameter by which a caller could redirect it. This is what keeps the route from
    // being an open relay.
    const h = harness();
    await h.start();

    expect(h.sent).toEqual([{ kind: "code", to: EMAIL, code: CODE }]);
  });
});

describe("verifying a request", () => {
  it("delivers to the owner and stores exactly one row", async () => {
    const h = harness();
    await h.verify(await h.start(), CODE);

    expect(h.sent.at(-1)).toMatchObject({ kind: "delivery", to: DESTINATION });
    expect(h.rows.size).toBe(1);
    expect(h.rows.get(EMAIL)?.status).toBe("new");
  });

  it("refuses the wrong code", async () => {
    const h = harness();
    const token = await h.start();

    await expect(h.verify(token, "000000")).rejects.toThrow();
    expect(h.rows.size).toBe(0);
  });

  it("refuses an expired token", async () => {
    const h = harness();
    const token = await h.start();
    h.clock.set(new Date(AT.getTime() + 16 * 60 * 1000));

    await expect(h.verify(token, CODE)).rejects.toThrow();
    expect(h.rows.size).toBe(0);
  });

  it("refuses a tampered token", async () => {
    const h = harness();
    const token = await h.start();

    // Swap the payload for one naming a different address, keeping the original signature.
    const forged = h.tokenSigner.sign({
      request: { email: "attacker@example.com" },
      codeMac: "00",
      exp: AT.getTime() + 60_000,
    });
    const [forgedPayload] = forged.split(".");
    const [, realSignature] = token.split(".");

    await expect(h.verify(`${forgedPayload}.${realSignature}`, CODE)).rejects.toThrow();
    expect(h.rows.size).toBe(0);
  });

  it("never logs the address", async () => {
    // The log line is a fixed code; the address must not ride along inside it.
    const h = harness();
    await h.verify(await h.start(), CODE);

    expect(JSON.stringify(h.lines)).not.toContain("marta");
  });
});

describe("the daily send ceiling", () => {
  it("refuses once the day's budget is spent", async () => {
    // The harness sets the limit to 4, and a start costs 2 — the code mail plus the delivery it
    // commits to — so two starts spend the day.
    const h = harness();
    await h.start();
    await h.start();

    await expect(h.start()).rejects.toThrow(/daily outbound mail limit/);
  });

  it("sends no mail on the request it refuses", async () => {
    // The whole point. A ceiling checked after the send is a counter, not a cap.
    const h = harness();
    await h.start();
    await h.start();
    const before = h.sent.length;

    await expect(h.start()).rejects.toThrow();

    expect(h.sent.length).toBe(before);
  });

  it("counts per UTC day, so tomorrow starts clean", async () => {
    const h = harness();
    await h.start();
    await h.start();
    await expect(h.start()).rejects.toThrow();

    h.clock.set(new Date("2026-09-10T00:05:00.000Z"));
    await expect(h.start()).resolves.toBeTypeOf("string");
  });

  it("prices the delivery at start, so a requester holding a code is never stranded", async () => {
    // **The same promise the old "does not cap verify" test made, held by a different mechanism.**
    // an earlier decision's product ruling stands: nobody who has just proved they own an address is turned away.
    // What changed is the accounting — that delivery was bought when the token was issued, so
    // `verify` consults no budget at all, which is exactly why the question "what should verify do
    // when the budget is gone?" cannot arise.
    const h = harness();
    await h.start();
    const token = await h.start();
    await expect(h.start()).rejects.toThrow();

    await expect(h.verify(token, CODE)).resolves.toBeUndefined();
    expect(h.sent.at(-1)).toMatchObject({ kind: "delivery" });
    // Six: two units per start, the refused one included — increments-then-judges errs toward
    // sending less. The delivery above added nothing, because verify never reserves.
    expect(h.days.get("2026-09-09")).toBe(6);
  });
});
