import createMiddleware from "next-intl/middleware";

import { routing } from "./i18n/routing";

export default createMiddleware(routing);

/**
 * Next 16 renamed this file convention from `middleware` to `proxy`. Same export shape and the
 * same matcher semantics; the old name still resolves but warns on every build.
 *
 * **`api` in this matcher is the whole product on this page.**
 *
 * The access-request form posts to `/api/access-request/start` and `/verify`, which are route
 * handlers rather than pages. next-intl's documented matcher is a broad `'/((?!_next|_vercel|.*\\..*).*)'`
 * that happily matches them, and a matched route handler gets redirected to `/en/api/...`, which
 * does not exist. The form would then fail on submit, in production, with a 404 that looks nothing
 * like an i18n bug. It is excluded here by name, first, before anything else.
 *
 * The rest excludes Next's internals, and any path with a dot in it so that `/icon.svg`,
 * `/robots.txt`, `/sitemap.xml` and the vendored fonts under `/fonts/` are served rather than
 * redirected into a locale that has no such file.
 */
export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
