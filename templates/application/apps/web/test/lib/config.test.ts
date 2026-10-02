import { describe, expect, it } from "vitest";

import { parseConfig } from "@/lib/config";

const CLERK = { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x", CLERK_SECRET_KEY: "sk_test_x" };

describe("parseConfig", () => {
  it("reaches the API on this machine when nothing is set", () => {
    expect(parseConfig({ NODE_ENV: "development" })).toEqual({
      apiBaseUrl: "http://localhost:__MKTRUE_API_PORT__",
      authEnabled: false,
    });
  });

  it("reads a blank API_BASE_URL as unset", () => {
    expect(parseConfig({ NODE_ENV: "production", API_BASE_URL: "" }).apiBaseUrl).toBe(
      "http://localhost:__MKTRUE_API_PORT__",
    );
  });

  it("turns sign-in on only with both halves of the Clerk pair", () => {
    expect(parseConfig({ NODE_ENV: "production", ...CLERK }).authEnabled).toBe(true);
    expect(parseConfig({ NODE_ENV: "production", CLERK_SECRET_KEY: "sk_test_x" }).authEnabled).toBe(
      false,
    );
    expect(
      parseConfig({ NODE_ENV: "production", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x" })
        .authEnabled,
    ).toBe(false);
  });

  it("counts the dev session as sign-in only in development", () => {
    expect(
      parseConfig({ NODE_ENV: "development", DEV_AUTH_USER_ID: "user_dev_1" }).authEnabled,
    ).toBe(true);
    expect(
      parseConfig({ NODE_ENV: "production", DEV_AUTH_USER_ID: "user_dev_1" }).authEnabled,
    ).toBe(false);
    expect(parseConfig({ NODE_ENV: "development", DEV_AUTH_USER_ID: "" }).authEnabled).toBe(false);
  });
});
