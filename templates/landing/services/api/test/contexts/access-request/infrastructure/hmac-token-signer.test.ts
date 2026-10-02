import { describe, expect, it } from "vitest";

import { createHmacTokenSigner } from "../../../../src/contexts/access-request/infrastructure/hmac-token-signer";

const payload = { request: { email: "marta@example.com" }, codeHash: "abc", exp: 1 };

describe("the HMAC token signer", () => {
  it("round-trips a payload", () => {
    const signer = createHmacTokenSigner("secret");

    expect(signer.verify(signer.sign(payload))).toEqual(payload);
  });

  it("refuses a token signed with a different secret", () => {
    const token = createHmacTokenSigner("secret-a").sign(payload);

    expect(createHmacTokenSigner("secret-b").verify(token)).toBeNull();
  });

  it("refuses a token whose payload was edited", () => {
    const signer = createHmacTokenSigner("secret");
    const [, signature] = signer.sign(payload).split(".");
    const edited = Buffer.from(
      JSON.stringify({ ...payload, exp: 9_999_999_999_999 }),
      "utf8",
    ).toString("base64url");

    expect(signer.verify(`${edited}.${signature}`)).toBeNull();
  });

  it("answers null for garbage rather than throwing", () => {
    const signer = createHmacTokenSigner("secret");

    for (const token of ["", ".", "a.b", "not-a-token", "a.b.c"]) {
      expect(signer.verify(token), token).toBeNull();
    }
  });

  it("digests a token stably, and to something that is not a token", () => {
    // The replay marker. Two tokens differing only in `exp` must not share a digest, or a
    // genuine second request would be mistaken for a replay of the first and silently dropped. The
    // hex shape is also the proof it cannot be the token: a token always carries a dot.
    const signer = createHmacTokenSigner("secret");
    const token = signer.sign(payload);
    const other = signer.sign({ ...payload, exp: 2 });

    expect(signer.digest(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(signer.digest(token)).toBe(signer.digest(token));
    expect(signer.digest(token)).not.toBe(signer.digest(other));
  });

  it("refuses to exist without a secret", () => {
    // A blank secret would sign every payload identically — anyone could mint a token.
    expect(() => createHmacTokenSigner("")).toThrow();
  });
});
