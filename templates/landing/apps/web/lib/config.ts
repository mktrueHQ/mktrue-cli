import "server-only";

/**
 * The page's configuration.
 *
 * `NEXT_PUBLIC_*` values are inlined into the client bundle at build time and are public by
 * definition; everything else is read server-side only. **There is no `NEXT_PUBLIC_API_URL`, and
 * that is deliberate:** the browser never calls the API. It posts to this app's own route
 * handlers, which forward server-side over the private compose network.
 *
 * `NEXT_PUBLIC_SOURCE_URL` is gone too: __MKTRUE_TITLE__ is not being open-sourced, so the CTA it
 * fed pointed at something no reader could reach.
 */

/**
 * Reads an env var, treating blank as absent.
 *
 * **`??` is the wrong operator for this, and it broke a deploy.** It falls back only on
 * `null` and `undefined`, and a Docker `ARG` that is declared but never passed arrives as an
 * **empty string**. So `NEXT_PUBLIC_SITE_URL ?? "https://…"` kept the empty string, `new URL("")`
 * threw `ERR_INVALID_URL`, and the production build died in `generateMetadata` on the first
 * prerendered page. The image had built fine locally, where the var was set.
 *
 * The same shape was latent on every other var here: a blank `NEXT_PUBLIC_OWNER_NAME` would have
 * printed "built and run by , a software engineer" on the about page rather than falling back.
 * Blank means absent, everywhere, and it is trimmed because a stray space in a deploy panel is the
 * other way this arrives.
 */
function fromEnv(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? fallback : trimmed;
}

export const config = {
  /** Where "Go to the app" goes: __MKTRUE_TITLE__ itself. Blank hides every link to it (see {@link hasApp}). */
  appUrl: fromEnv(process.env.NEXT_PUBLIC_APP_URL, ""),
  /** Server-side only. Resolves on the private network; never reaches the browser. */
  apiBaseUrl: fromEnv(process.env.API_BASE_URL, "http://localhost:4201"),
  /** Shown on the legal pages. The person actually responsible for the data. */
  ownerName: fromEnv(process.env.NEXT_PUBLIC_OWNER_NAME, "__MKTRUE_OWNER__"),
  /**
   * The site's own absolute origin, and the base for every canonical, hreflang and share-card URL.
   *
   * Absolute rather than relative because Open Graph and hreflang have no notion of a relative URL:
   * a crawler that reads `/es/privacy` has nowhere to resolve it from. Defaulted rather than
   * required so a clone and CI both build, and **this is the one that must never be empty**: every
   * other value here degrades to a hidden link, while this one reaches `new URL()`.
   */
  siteUrl: fromEnv(process.env.NEXT_PUBLIC_SITE_URL, "https://__MKTRUE_NAME__.example.com").replace(
    /\/+$/,
    "",
  ),
  /**
   * Where a privacy or legal request goes.
   *
   * A URL, not an address. There is no __MKTRUE_NAME__.example.com mailbox to write to, and the legal pages
   * were printing one that would have bounced, which on a privacy page is worse than printing
   * nothing: the whole page is a promise that someone will answer. This points at the contact form
   * already running on the portfolio, which is a route that actually reaches a person.
   */
  contactUrl: fromEnv(process.env.NEXT_PUBLIC_CONTACT_URL, ""),
} as const;

/**
 * True when the app's URL is configured.
 *
 * Removing "View the source" removed `hasSource`, and with it the only guard stopping a blank env
 * var becoming `href=""`, a dead anchor that still looks clickable. The rule outlived the CTA it
 * was written for: fail closed, applied to a link (CLAUDE.md §4.5). Caught by the test that used to
 * cover the source link and now covers every link on the page.
 */
export const hasApp = config.appUrl.length > 0;

/** True when a contact route is configured. Same fail-closed rule as {@link hasApp}. */
export const hasContact = config.contactUrl.length > 0;
