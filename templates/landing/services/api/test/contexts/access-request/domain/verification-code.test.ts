import { describe, expect, it } from "vitest";

import { VerificationCode } from "../../../../src/contexts/access-request/domain/verification-code";

describe("VerificationCode", () => {
  it("is exactly six digits", () => {
    for (const bad of ["12345", "1234567", "12a456", ""]) {
      expect(() => VerificationCode.of(bad), bad).toThrow();
    }
    expect(VerificationCode.of("040722").value).toBe("040722");
  });
});
