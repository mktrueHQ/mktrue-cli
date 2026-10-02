import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import { routing } from "./routing";

/**
 * Resolves the request's locale and loads its messages.
 *
 * `hasLocale` rather than a cast: the segment arrives as an arbitrary string, and a request for
 * `/de/privacy` must fall back to a real locale rather than reaching `import("../messages/de.json")`
 * and throwing at module load. A 404 for an unknown locale is `[locale]/layout.tsx`'s job; this
 * function's job is never to be the thing that crashes first.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
