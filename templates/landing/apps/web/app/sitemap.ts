import type { MetadataRoute } from "next";

import { type AppLocale, routing } from "@/i18n/routing";
import { buildCanonical, buildLanguageAlternates } from "@/lib/seo";

/**
 * Every page, in every locale, with its hreflang set.
 *
 * There was no sitemap at all until an earlier decision: `/sitemap.xml` answered 404 while `robots.txt` answered
 * 200 with Cloudflare's injected default, which points at no sitemap. So the only route in was a
 * crawler guessing.
 *
 * **Order matters against the i18n work.** `localePrefix: "always"` means `/privacy` is now
 * `/en/privacy`, so a sitemap written before the locale routing landed would have listed a set of
 * URLs that all 308 away. It is built from `buildCanonical`, which is the same function the pages
 * use for their own canonical tag, so the two cannot disagree.
 */
const PATHS = ["", "/about", "/request-access", "/privacy", "/terms"] as const;

function entriesFor(locale: AppLocale): MetadataRoute.Sitemap {
  return PATHS.map((path) => ({
    url: buildCanonical(locale, path),
    // `/` is the page anyone actually lands on; the legal pages are load-bearing but secondary.
    priority: path === "" ? 1 : 0.6,
    changeFrequency: "monthly" as const,
    alternates: { languages: buildLanguageAlternates(path) },
  }));
}

export default function sitemap(): MetadataRoute.Sitemap {
  return routing.locales.flatMap(entriesFor);
}
