import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Configuration has to survive a blank environment, not just a missing one.
 *
 * **This is the deploy that failed.** A Docker `ARG` that is declared but never passed
 * arrives as an empty string, not as `undefined`, so `??` keeps it. `NEXT_PUBLIC_SITE_URL` reached
 * `new URL("")`, which throws `ERR_INVALID_URL`, and the production build died while prerendering
 * `/en`. It had built fine locally and in the `landing-web` target, because both had the var set:
 * only `landing-api`, which shares the builder stage and passes no web args, hit the empty case.
 *
 * So every case below sets the var to `""` rather than deleting it. Deleting it tests `undefined`,
 * which was never the broken path.
 */
async function loadConfig(env: Readonly<Record<string, string>>) {
  vi.resetModules(); // The module reads `process.env` once, at import.
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import("@/lib/config");
}

const BLANK = {
  NEXT_PUBLIC_SITE_URL: "",
  NEXT_PUBLIC_APP_URL: "",
  NEXT_PUBLIC_OWNER_NAME: "",
  NEXT_PUBLIC_CONTACT_URL: "",
  API_BASE_URL: "",
} as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("config", () => {
  it("gives a usable site URL when the var is blank", async () => {
    const { config } = await loadConfig(BLANK);

    // The assertion that matters is that this does not throw.
    expect(() => new URL(config.siteUrl)).not.toThrow();
    expect(config.siteUrl).toMatch(/^https:\/\//);
  });

  it("falls back rather than printing an empty owner", async () => {
    const { config } = await loadConfig(BLANK);

    // "built and run by , a software engineer" is what the about page said otherwise.
    expect(config.ownerName).not.toBe("");
  });

  it("keeps a usable API base when the var is blank", async () => {
    const { config } = await loadConfig(BLANK);

    expect(() => new URL(config.apiBaseUrl)).not.toThrow();
  });

  it("treats a blank optional URL as absent, so its links stay hidden", async () => {
    // These two legitimately have no fallback: blank means "hide the link", and the guards are
    // what keep `href=""` off the page (CLAUDE.md §4.5).
    const { config, hasApp, hasContact } = await loadConfig(BLANK);

    expect(config.appUrl).toBe("");
    expect(config.contactUrl).toBe("");
    expect(hasApp).toBe(false);
    expect(hasContact).toBe(false);
  });

  it("treats whitespace as blank", async () => {
    // The other way this arrives: a stray space pasted into a deploy panel.
    const { config, hasApp } = await loadConfig({ ...BLANK, NEXT_PUBLIC_APP_URL: "   " });

    expect(hasApp).toBe(false);
    expect(config.appUrl).toBe("");
  });

  it("trims a configured value rather than trusting it", async () => {
    const { config, hasApp } = await loadConfig({
      ...BLANK,
      NEXT_PUBLIC_APP_URL: "  https://__MKTRUE_NAME__.example.com  ",
      NEXT_PUBLIC_SITE_URL: "https://get-__MKTRUE_NAME__.example.com/",
    });

    expect(config.appUrl).toBe("https://__MKTRUE_NAME__.example.com");
    expect(hasApp).toBe(true);
    // The trailing slash goes, or every canonical would carry a double slash.
    expect(config.siteUrl).toBe("https://get-__MKTRUE_NAME__.example.com");
  });
});
