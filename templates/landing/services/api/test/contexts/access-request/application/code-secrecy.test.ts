import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { CODE, EMAIL, harness } from "../../../test-support/harness";

/** Every string a token's holder can read: each value of its payload, and its signature. */
function exposedBy(token: string): Set<string> {
  const [encoded = "", signature = ""] = token.split(".");
  const exposed = new Set<string>([signature]);
  const collect = (value: unknown): void => {
    if (typeof value === "string") exposed.add(value);
    else if (typeof value === "object" && value !== null) Object.values(value).forEach(collect);
  };
  collect(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
  return exposed;
}

/** The first code whose unkeyed digest the token shows, alone or beside the expiry. */
function recoverCode(token: string): string | null {
  const exposed = exposedBy(token);
  const { exp } = JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8"));

  for (let i = 0; i < 1_000_000; i += 1) {
    const guess = String(i).padStart(6, "0");
    for (const input of [guess, `${guess}${exp}`, `${exp}${guess}`]) {
      const digest = createHash("sha256").update(input).digest();
      if (exposed.has(digest.toString("hex")) || exposed.has(digest.toString("base64url"))) {
        return guess;
      }
    }
  }
  return null;
}

/** A token as the unkeyed scheme made it: the code's SHA-256 in the payload. */
function unkeyedToken(codeDigestInput: (exp: number) => string): string {
  const exp = 1_789_000_000_000;
  const payload = {
    request: { email: "marta@example.com", note: "I want to see the undo log." },
    codeHash: createHash("sha256").update(codeDigestInput(exp)).digest("hex"),
    exp,
  };
  return `${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}.signature`;
}

describe("the code, to whoever holds the token", () => {
  it("is found in a token that carries its unkeyed hash, so the search below can fail", () => {
    expect(recoverCode(unkeyedToken(() => CODE))).toBe(CODE);
    expect(recoverCode(unkeyedToken((exp) => `${CODE}${exp}`))).toBe(CODE);
  });

  it("is not found by trying all 1,000,000 codes without the secret", async () => {
    const h = harness();
    const token = await h.start();

    expect(recoverCode(token)).toBeNull();
    // The token is a real one: the mailed code still verifies it.
    await expect(h.verify(token, CODE)).resolves.toBeUndefined();
  }, 60_000);

  it("has no field to travel in: the payload is the request, the code's MAC and the expiry", async () => {
    const token = await harness().start();
    const payload: unknown = JSON.parse(
      Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8"),
    );

    expect(token.split(".")).toHaveLength(2);
    expect(payload).toEqual({
      request: { email: EMAIL, note: "I want to see the undo log." },
      codeMac: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      exp: expect.any(Number),
    });
  });

  it("is in the token nowhere as itself", async () => {
    const token = await harness().start();

    expect([...exposedBy(token)].join("\n")).not.toContain(CODE);
  });
});
