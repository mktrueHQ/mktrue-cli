import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createHmacTokenSigner } from "../../../../src/contexts/access-request/infrastructure/hmac-token-signer";

const payload = {
  request: { email: "marta@example.com", note: "I want to see the undo log." },
  codeMac: "abc",
  exp: 1,
};

describe("the code's MAC", () => {
  const CODE = "040722";
  const signer = createHmacTokenSigner("secret-a");
  const sealed = { ...payload, codeMac: signer.sealCode(CODE, payload.request, payload.exp) };

  it("matches the code it sealed and no other", () => {
    expect(signer.codeMatches(CODE, sealed)).toBe(true);
    expect(signer.codeMatches("040723", sealed)).toBe(false);
  });

  it("fails under a different secret, with the right code", () => {
    expect(createHmacTokenSigner("secret-b").codeMatches(CODE, sealed)).toBe(false);
    expect(createHmacTokenSigner("secret-b").sealCode(CODE, payload.request, payload.exp)).not.toBe(
      sealed.codeMac,
    );
  });

  it("is bound to the expiry and to each field of the request", () => {
    const { request } = payload;
    const others = [
      { ...sealed, exp: 2 },
      { ...sealed, request: { ...request, email: "other@example.com" } },
      { ...sealed, request: { ...request, note: "I want to see the redo log." } },
      { ...sealed, request: { email: request.email } },
    ];

    for (const other of others) expect(signer.codeMatches(CODE, other)).toBe(false);
  });

  it("tells a request with no note from one whose note is any text", () => {
    const bare = { email: "marta@example.com" };
    const withoutNote = signer.sealCode(CODE, bare, 1);

    for (const note of ["", "null", "undefined"]) {
      expect(signer.sealCode(CODE, { ...bare, note }, 1), note).not.toBe(withoutNote);
    }
  });

  it("refuses a MAC that differs in its last character, and one that is only a prefix", () => {
    const last = sealed.codeMac.at(-1) === "A" ? "B" : "A";
    const nearly = sealed.codeMac.slice(0, -1) + last;
    const prefix = sealed.codeMac.slice(0, 8);

    expect(signer.codeMatches(CODE, { ...sealed, codeMac: nearly })).toBe(false);
    expect(signer.codeMatches(CODE, { ...sealed, codeMac: prefix })).toBe(false);
  });

  it("answers false for a malformed or missing MAC instead of throwing", () => {
    for (const codeMac of ["", "not-a-mac", undefined]) {
      expect(signer.codeMatches(CODE, { ...sealed, codeMac } as never)).toBe(false);
    }
  });

  it("is HMAC-SHA-256 over the labelled list of what it binds, by a known answer", () => {
    const answer = (fields: readonly unknown[]) =>
      createHmac("sha256", "secret-a").update(JSON.stringify(fields)).digest("base64url");
    const { email, note } = payload.request;

    expect(sealed.codeMac).toBe(answer(["access-request.code.v1", CODE, 1, email, note]));
    expect(signer.sealCode(CODE, { email }, 1)).toBe(
      answer(["access-request.code.v1", CODE, 1, email, null]),
    );
    // Without its label it is another MAC.
    expect(sealed.codeMac).not.toBe(answer([CODE, 1, email, note]));
  });
});

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
