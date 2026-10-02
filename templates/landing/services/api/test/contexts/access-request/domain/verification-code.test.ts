import { describe, expect, it } from "vitest";

import { VerificationCode } from "../../../../src/contexts/access-request/domain/verification-code";

describe("VerificationCode", () => {
  it("is exactly six digits", () => {
    for (const bad of ["12345", "1234567", "12a456", ""]) {
      expect(() => VerificationCode.of(bad), bad).toThrow();
    }
    expect(VerificationCode.of("040722").value).toBe("040722");
  });

  it("matches its own hash and nothing else", () => {
    const code = VerificationCode.of("040722");

    expect(code.matches(code.hash())).toBe(true);
    expect(code.matches(VerificationCode.of("040723").hash())).toBe(false);
  });

  it("refuses a malformed hash instead of throwing", () => {
    // A tampered token could carry anything here; the comparison must answer false, not crash.
    expect(VerificationCode.of("040722").matches("not-hex")).toBe(false);
    expect(VerificationCode.of("040722").matches("")).toBe(false);
  });
});
