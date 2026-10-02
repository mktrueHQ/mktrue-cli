import "server-only";

import type { Metadata } from "next";
import { hasLocale } from "next-intl";

import { type AppLocale, routing } from "@/i18n/routing";
import { config } from "@/lib/config";

/**
 * Every SEO surface on the site, in one place.
 *
 * Before this file the page had a title, a description, a theme colour and an icon, and that was
 * the entire `<head>`. No canonical, no Open Graph, no Twitter card, no hreflang, no sitemap, and a
 * `robots.txt` that answered 200 only because Cloudflare injects a default one. A link pasted into
 * a DM unfurled as a grey rectangle, and a DM is the only way this page reaches anybody.
 */

/**
 * Callers pass whatever `params.locale` a page received, which is an arbitrary string until
 * `[locale]/layout.tsx` narrows it. Normalising once here beats repeating the check at every call
 * site and risking a raw segment reaching a public URL.
 */
function toAppLocale(locale: string): AppLocale {
  return hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
}

/** The one absolute URL shape: `${siteUrl}/${locale}${path}`, with `path` locale-less. */
export function buildCanonical(locale: string, path: string): string {
  return `${config.siteUrl}/${toAppLocale(locale)}${path}`;
}

/**
 * The hreflang map alone, as a plain `Record<string, string>`.
 *
 * Every page exists in both locales, so this always names both and adds `x-default`, the entry a
 * search engine uses when no `Accept-Language` matches. Omitting `x-default` is the usual way a
 * two-locale site ends up with the wrong one indexed.
 *
 * Split out from {@link buildAlternates} because `sitemap.ts` wants `Languages<string>` while
 * `Metadata["alternates"]` widens it to allow `URL`, arrays and `null`. Passing the metadata shape
 * straight into the sitemap is a type error, and the tempting fix is a cast, which would let a
 * `null` alternate reach a sitemap entry silently.
 */
export function buildLanguageAlternates(path: string): Record<string, string> {
  const languages = Object.fromEntries(
    routing.locales.map((loc) => [loc, buildCanonical(loc, path)] as const),
  );

  return { ...languages, "x-default": buildCanonical(routing.defaultLocale, path) };
}

export function buildAlternates(locale: string, path: string): Metadata["alternates"] {
  return {
    canonical: buildCanonical(locale, path),
    languages: buildLanguageAlternates(path),
  };
}

/**
 * Open Graph wants `language_TERRITORY`, not the bare locale next-intl routes on.
 *
 * A lookup with a fallback rather than a map keyed by the locale union: a
 * product choosing one language, or a language not listed here, must still get a
 * well-formed tag instead of `undefined`.
 */
const OPEN_GRAPH_LOCALES: Readonly<Record<string, string>> = {
  en: "en_US",
  es: "es_ES",
  fr: "fr_FR",
  de: "de_DE",
  pt: "pt_PT",
  it: "it_IT",
};

export function toOpenGraphLocale(locale: string): string {
  const app = toAppLocale(locale);
  return OPEN_GRAPH_LOCALES[app] ?? `${app}_${app.toUpperCase()}`;
}

/**
 * The shared metadata every page merges into: canonical, hreflang, Open Graph and the Twitter card.
 *
 * The share image is deliberately **not** listed. Next finds `opengraph-image.tsx` by file
 * convention and injects `og:image` plus `twitter:image` with the right absolute URL, dimensions
 * and type. Naming it here as well produces two `og:image` tags, and which one a crawler picks is
 * its business rather than ours.
 */
export function buildPageMetadata({
  locale,
  path,
  title,
  description,
  siteName,
}: {
  readonly locale: string;
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly siteName: string;
}): Metadata {
  const url = buildCanonical(locale, path);

  return {
    title,
    description,
    alternates: buildAlternates(locale, path),
    openGraph: {
      type: "website",
      url,
      siteName,
      title,
      description,
      locale: toOpenGraphLocale(locale),
      alternateLocale: routing.locales
        .filter((l) => l !== toAppLocale(locale))
        .map(toOpenGraphLocale),
    },
    twitter: { card: "summary_large_image", title, description },
  };
}
