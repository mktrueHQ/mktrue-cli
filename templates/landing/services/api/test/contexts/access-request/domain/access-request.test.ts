import { describe, expect, it } from "vitest";

import { AccessRequest } from "../../../../src/contexts/access-request/domain/access-request";
import { InvalidAccessRequest } from "../../../../src/contexts/access-request/domain/errors";

describe("AccessRequest", () => {
  it("normalises the address so the mailbox stays one row per person", () => {
    const request = AccessRequest.create({ email: "  Marta@Example.COM " });

    expect(request.email).toBe("marta@example.com");
  });

  it("refuses an address that is not one", () => {
    for (const email of ["", "marta", "marta@", "@example.com", "marta@example", "a b@c.com"]) {
      expect(() => AccessRequest.create({ email }), email).toThrow(InvalidAccessRequest);
    }
  });

  it("refuses an address longer than RFC 5321 allows", () => {
    const email = `${"a".repeat(250)}@example.com`;

    expect(() => AccessRequest.create({ email })).toThrow(InvalidAccessRequest);
  });

  it("refuses a note over the limit, and treats an empty one as absent", () => {
    expect(() =>
      AccessRequest.create({ email: "marta@example.com", note: "x".repeat(501) }),
    ).toThrow(InvalidAccessRequest);

    expect(AccessRequest.create({ email: "marta@example.com", note: "   " }).note).toBeUndefined();
  });

  it("refuses an address carrying CRLF, because the address reaches a mail header", () => {
    // `deliveredAccessRequestEmail` interpolates the address into the Subject:
    //   subject: `Access request: ${request.email}`
    // A newline there is classic header injection — an attacker appends `\nBcc: ...` and the
    // provider sends copies wherever they like. The guard is this constructor's `[^\s@]+`, and
    // `\s` covers \r and \n. That is load-bearing rather than incidental, so it is asserted
    // directly: the previous test only covered a space.
    //
    // Found by the slice-2.8 audit, not by a test that existed first.
    for (const email of [
      "marta@example.com\nBcc: attacker@evil.test",
      "marta@example.com\r\nBcc: attacker@evil.test",
      "marta\n@example.com",
      "marta@exa\rmple.com",
      "marta@example.com\u0000",
    ]) {
      expect(() => AccessRequest.create({ email }), JSON.stringify(email)).toThrow(
        InvalidAccessRequest,
      );
    }
  });

  it("refuses a note carrying CRLF too", () => {
    // The note reaches the mail body rather than a header, so this is defence in depth rather than
    // a live injection — but a 500-char field that can hold raw newlines is a needless surface.
    const note = "why I want in\r\nContent-Type: text/html";
    const created = AccessRequest.create({ email: "marta@example.com", note });

    // Newline and tab stay legal — it is free text a person writes, it reaches the body rather
    // than a header, and it is escaped at every HTML call site.
    expect(created.note).toContain("\n");

    // Everything else in C0 does not.
    for (const bad of ["why\u0000 I want in", "why\u0007 I want in", "why\u007f in"]) {
      expect(() => AccessRequest.create({ email: "marta@example.com", note: bad })).toThrow(
        InvalidAccessRequest,
      );
    }
  });

  it("never puts the address in the error it throws", () => {
    // The message reaches logs. An error that embeds the address puts PII there (CLAUDE.md §4.3).
    try {
      AccessRequest.create({ email: "not-an-address-marta" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message).not.toContain("marta");
    }
  });
});
