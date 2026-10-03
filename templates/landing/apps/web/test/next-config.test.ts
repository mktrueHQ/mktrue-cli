import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";

describe("next.config", () => {
  it("sends HSTS beside the other security headers, on every path", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];

    expect(rules.map((rule) => rule.source)).toEqual(["/:path*"]);
    const headers = new Map(rules[0]?.headers.map((header) => [header.key, header.value]));
    expect(headers.get("Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains");
    expect(headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("does not name the framework in a response header", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
