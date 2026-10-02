import { defineRouting } from "next-intl/routing";

/**
 * The single source of truth for locales. Everything else derives from it: the middleware, the
 * typed navigation helpers, `lib/seo`, the sitemap and the two share cards.
 *
 * **No locale is an afterthought.** Every locale gets the same treatment the default
 * does: its own prefix, its own canonical, its own share card, and its own copy
 * written rather than translated. A locale that only ever receives machine
 * translation is a locale nobody checked.
 *
 * `localePrefix: "always"` is the load-bearing choice. It means `/` redirects to `/en` and there is
 * exactly one canonical URL per page per language, which is what makes the hreflang set in
 * `lib/seo` honest. The alternative, hiding the default locale's prefix, gives the same page two
 * addresses and hands a search engine a duplicate-content problem for free.
 */
export const routing = defineRouting({
  locales: [__MKTRUE_LOCALES__],
  defaultLocale: "en",
  localePrefix: "always",
});

export type AppLocale = (typeof routing.locales)[number];
