import { describe, expect, it } from "vitest";

import { parseConfig } from "@/lib/config";

const CLERK = { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x", CLERK_SECRET_KEY: "sk_test_x" };

describe("parseConfig", () => {
  it("has no API base when nothing is set: there is no localhost fallback", () => {
    expect(parseConfig({ NODE_ENV: "development" })).toEqual({
      apiBaseUrl: undefined,
      authEnabled: false,
    });
  });

  it.each(["", "   "])("reads a blank API_BASE_URL (%j) as unset", (blank) => {
    expect(parseConfig({ NODE_ENV: "production", API_BASE_URL: blank }).apiBaseUrl).toBeUndefined();
  });

  it("reads a configured API_BASE_URL, trimmed", () => {
    expect(
      parseConfig({ NODE_ENV: "production", API_BASE_URL: " http://api:4000 " }).apiBaseUrl,
    ).toBe("http://api:4000");
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
