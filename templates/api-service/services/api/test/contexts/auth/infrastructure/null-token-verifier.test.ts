import { describe, expect, it } from "vitest";

import { AuthNotConfiguredError } from "@api/contexts/auth/application/errors";
import type { TokenVerifier } from "@api/contexts/auth/application/ports";
import { NullTokenVerifier } from "@api/contexts/auth/infrastructure/null-token-verifier";

describe("NullTokenVerifier", () => {
  it.each([
    ["a well-formed token", "eyJhbGciOiJSUzI1NiJ9.payload.signature"],
    ["an empty string", ""],
    ["the word test", "test"],
  ])("refuses %s as not configured", async (_case, token) => {
    const verifier: TokenVerifier = new NullTokenVerifier();

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(AuthNotConfiguredError);
  });
});
