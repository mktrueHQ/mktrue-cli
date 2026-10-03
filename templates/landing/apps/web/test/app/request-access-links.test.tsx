import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// With `API_BASE_URL` blank, /request-access is a 404, so nothing may lead to it: not the home
// page, the header, the footer or the sitemap. Setting the variable brings every one back.
vi.mock("next-intl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-intl")>()),
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { readonly href: string; readonly children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const OFF = { API_BASE_URL: "", NEXT_PUBLIC_APP_URL: "", NEXT_PUBLIC_SITE_URL: "" } as const;
const ON = { ...OFF, API_BASE_URL: "http://api:4201" } as const;

async function load(env: Readonly<Record<string, string>>) {
  vi.resetModules(); // `lib/config` reads `process.env` once, at import.
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);

  const { default: HomePage } = await import("@/app/[locale]/page");
  const { SiteHeader } = await import("@/app/components/site-header");
  const { SiteFooter } = await import("@/app/components/site-footer");
  const { default: sitemap } = await import("@/app/sitemap");

  return {
    surfaces: {
      home: renderToStaticMarkup(<HomePage />),
      header: renderToStaticMarkup(<SiteHeader />),
      footer: renderToStaticMarkup(<SiteFooter />),
    },
    sitemap: sitemap().map((entry) => entry.url),
  };
}

const hrefsIn = (markup: string): string[] =>
  [...markup.matchAll(/href="([^"]*)"/g)].map((match) => match[1] ?? "");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("links to /request-access", () => {
  it.each(["", "   "])("are offered nowhere while API_BASE_URL is %j", async (blank) => {
    const { surfaces, sitemap } = await load({ ...OFF, API_BASE_URL: blank });

    for (const [surface, markup] of Object.entries(surfaces)) {
      const hrefs = hrefsIn(markup);
      expect(
        hrefs.filter((href) => href.includes("request-access")),
        surface,
      ).toEqual([]);
      expect(
        hrefs.filter((href) => href.trim() === ""),
        surface,
      ).toEqual([]);
      expect(markup, surface).not.toContain("requestAccess");
    }
    expect(sitemap.filter((url) => url.includes("request-access"))).toEqual([]);
    expect(sitemap.length).toBeGreaterThan(0);
  });

  it("are on the home page, the header, the footer and the sitemap once it is set", async () => {
    const { surfaces, sitemap } = await load(ON);

    for (const [surface, markup] of Object.entries(surfaces)) {
      expect(hrefsIn(markup), surface).toContain("/request-access");
    }
    expect(sitemap.filter((url) => url.endsWith("/request-access")).length).toBeGreaterThan(0);
  });

  it("leave the rest of the sitemap as it was, in the same order", async () => {
    const off = (await load(OFF)).sitemap;
    const on = (await load(ON)).sitemap;

    expect(on.filter((url) => !url.endsWith("/request-access"))).toEqual(off);
  });
});
