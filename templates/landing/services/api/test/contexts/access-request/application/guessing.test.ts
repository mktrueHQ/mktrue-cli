import { describe, expect, it } from "vitest";

import { CODE_VALIDITY_MS } from "../../../../src/contexts/access-request/application/start-access-request";
import { MAX_WRONG_CODES } from "../../../../src/contexts/access-request/application/verify-access-request";
import {
  InvalidVerificationCode,
  VerificationExpired,
} from "../../../../src/contexts/access-request/domain/errors";
import { createInMemoryWrongCodeCounter } from "../../../../src/contexts/access-request/infrastructure/in-memory-wrong-code-counter";
import { AT, CODE, harness } from "../../../test-support/harness";

const WRONG = "000000";

type Flow = ReturnType<typeof harness>;

/** Sends `times` wrong codes for one token and answers what each was refused with. */
async function guess(h: Flow, token: string, times: number): Promise<unknown[]> {
  const refusals: unknown[] = [];
  for (let i = 0; i < times; i += 1) {
    refusals.push(await h.verify(token, WRONG).catch((error: unknown) => error));
  }
  return refusals;
}

describe("guessing the code", () => {
  it("allows five wrong codes for one token", () => {
    expect(MAX_WRONG_CODES).toBe(5);
  });

  it("still takes the right code after four wrong ones", async () => {
    const h = harness();
    const token = await h.start();

    const refusals = await guess(h, token, 4);

    for (const refusal of refusals) expect(refusal).toBeInstanceOf(InvalidVerificationCode);
    await expect(h.verify(token, CODE)).resolves.toBeUndefined();
    expect(h.delivered()).toHaveLength(1);
    expect(h.rows.size).toBe(1);
  });

  it("refuses the right code after the fifth wrong one, as it refuses an expired token", async () => {
    const h = harness();
    const token = await h.start();

    const refusals = await guess(h, token, 5);
    expect(refusals.at(-1)).toBeInstanceOf(InvalidVerificationCode);

    await expect(h.verify(token, CODE)).rejects.toThrow(VerificationExpired);
    // And it stays dead: the right code again, and one more wrong one.
    await expect(h.verify(token, CODE)).rejects.toThrow(VerificationExpired);
    await expect(h.verify(token, WRONG)).rejects.toThrow(VerificationExpired);
    expect(h.delivered()).toHaveLength(0);
    expect(h.rows.size).toBe(0);
    // No line of its own: a dead token writes what an expired one writes, which is nothing.
    expect(h.lines).toEqual([]);
  });

  it("answers a dead token as expired whatever is sent as its code, a malformed one included", async () => {
    const h = harness();
    const token = await h.start();
    await guess(h, token, 5);

    for (const code of ["12345", "abcdef", "", "1234567"]) {
      await expect(h.verify(token, code), code).rejects.toThrow(VerificationExpired);
    }
  });

  it("counts each token by itself: one killed token leaves the next alive", async () => {
    const h = harness();
    const dead = await h.start();
    await guess(h, dead, 5);
    h.clock.set(new Date(AT.getTime() + 1));
    const fresh = await h.start();

    expect(fresh).not.toBe(dead);
    await expect(h.verify(dead, CODE)).rejects.toThrow(VerificationExpired);
    await expect(h.verify(fresh, CODE)).resolves.toBeUndefined();
  });

  it("does not count a token nobody signed, or a code that is no code", async () => {
    const h = harness({ countedTokens: 1 });
    const token = await h.start();

    for (let i = 0; i < 6; i += 1) {
      await expect(h.verify(`${token}x`, WRONG)).rejects.toThrow();
      await expect(h.verify(token, "12345")).rejects.toThrow();
    }

    // Neither filled the counter's one place, nor spent the token.
    await expect(h.verify(token, CODE)).resolves.toBeUndefined();
  });

  it("does not count a token that has already expired", async () => {
    const h = harness({ countedTokens: 1 });
    const old = await h.start();
    h.clock.set(new Date(AT.getTime() + CODE_VALIDITY_MS));
    await expect(h.verify(old, WRONG)).rejects.toThrow(VerificationExpired);

    const fresh = await h.start();
    await expect(h.verify(fresh, CODE)).resolves.toBeUndefined();
  });

  it("does not let a verified token be guessed at again past its five", async () => {
    const h = harness();
    const token = await h.start();
    await h.verify(token, CODE);

    await guess(h, token, 5);

    await expect(h.verify(token, CODE)).rejects.toThrow(VerificationExpired);
    expect(h.delivered()).toHaveLength(1);
  });
});

describe("the counter's bound", () => {
  it("refuses a token it has no room to count, right code or wrong", async () => {
    const h = harness({ countedTokens: 1 });
    const first = await h.start();
    await guess(h, first, 1);
    h.clock.set(new Date(AT.getTime() + 1));
    const second = await h.start();

    await expect(h.verify(second, WRONG)).rejects.toThrow(VerificationExpired);
    await expect(h.verify(second, CODE)).rejects.toThrow(VerificationExpired);
    // The token it does hold was not forgotten to make room: its one wrong code still counts.
    expect(await guess(h, first, 4)).toHaveLength(4);
    await expect(h.verify(first, CODE)).rejects.toThrow(VerificationExpired);
  });

  it("holds as many tokens as it was sized for, and forgets none of them for a new one", () => {
    const counter = createInMemoryWrongCodeCounter(2);
    const expiresAt = AT.getTime() + CODE_VALIDITY_MS;
    const now = AT.getTime();

    for (const digest of ["first", "second"]) {
      expect(counter.isSpent(digest, MAX_WRONG_CODES, now), digest).toBe(false);
      for (let i = 0; i < 4; i += 1) counter.record(digest, expiresAt);
    }

    expect(counter.isSpent("third", MAX_WRONG_CODES, now)).toBe(true);
    // Asking for the third forgot neither: one more wrong code spends each.
    for (const digest of ["first", "second"]) {
      expect(counter.isSpent(digest, MAX_WRONG_CODES, now), digest).toBe(false);
      counter.record(digest, expiresAt);
      expect(counter.isSpent(digest, MAX_WRONG_CODES, now), digest).toBe(true);
    }
    expect(counter.isSpent("third", MAX_WRONG_CODES, expiresAt)).toBe(false);
  });

  it("drops a count when its token expires, and has room again", async () => {
    const h = harness({ countedTokens: 1 });
    const first = await h.start();
    await guess(h, first, 1);
    h.clock.set(new Date(AT.getTime() + 60_000));
    const second = await h.start();
    await expect(h.verify(second, CODE)).rejects.toThrow(VerificationExpired);

    // The first token's last millisecond, then the one in which it has expired.
    h.clock.set(new Date(AT.getTime() + CODE_VALIDITY_MS - 1));
    await expect(h.verify(second, CODE)).rejects.toThrow(VerificationExpired);
    h.clock.set(new Date(AT.getTime() + CODE_VALIDITY_MS));

    await expect(h.verify(second, CODE)).resolves.toBeUndefined();
  });
});
