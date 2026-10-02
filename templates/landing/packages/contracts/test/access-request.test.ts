import { describe, expect, it } from "vitest";

import { startAccessRequestBodySchema, verifyAccessRequestBodySchema } from "../src/index";

describe("the start body", () => {
  it("normalises the address, so the API and the mailbox agree on one form", () => {
    const parsed = startAccessRequestBodySchema.parse({ email: "  Marta@Example.COM  " });

    expect(parsed.email).toBe("marta@example.com");
  });

  it("rejects what is not an address", () => {
    for (const email of ["", "marta", "marta@", "@example.com", "a b@c.com"]) {
      expect(startAccessRequestBodySchema.safeParse({ email }).success, email).toBe(false);
    }
  });

  it("bounds both fields", () => {
    // 254 is RFC 5321's maximum; 500 keeps the note readable in the delivered mail on a phone.
    expect(
      startAccessRequestBodySchema.safeParse({ email: `${"a".repeat(250)}@example.com` }).success,
    ).toBe(false);
    expect(
      startAccessRequestBodySchema.safeParse({ email: "a@b.co", note: "x".repeat(501) }).success,
    ).toBe(false);
  });

  it("treats the note as optional", () => {
    expect(startAccessRequestBodySchema.safeParse({ email: "a@b.co" }).success).toBe(true);
  });
});

describe("the verify body", () => {
  it("insists on exactly six digits", () => {
    for (const code of ["12345", "1234567", "abcdef", "12 456", ""]) {
      expect(verifyAccessRequestBodySchema.safeParse({ token: "t", code }).success, code).toBe(
        false,
      );
    }
    expect(verifyAccessRequestBodySchema.safeParse({ token: "t", code: "040722" }).success).toBe(
      true,
    );
  });

  it("bounds the token, so a huge string is a 400 rather than work", () => {
    expect(
      verifyAccessRequestBodySchema.safeParse({ token: "x".repeat(5000), code: "040722" }).success,
    ).toBe(false);
  });
});
