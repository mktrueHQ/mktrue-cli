import type { MetadataRoute } from "next";

import { config } from "@/lib/config";

/**
 * The app's own robots policy, replacing Cloudflare's injected default.
 *
 * `/robots.txt` already answered 200 before this file existed, which is what made it easy to miss:
 * the body was Cloudflare's AI content-signals boilerplate, so the site's crawl policy was whatever
 * a CDN decided and it named no sitemap.
 *
 * Everything is allowed except the two route handlers. They are POST-only endpoints behind a rate
 * limit, they render nothing, and a crawler that finds them gets a 405 for its trouble.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
    sitemap: `${config.siteUrl}/sitemap.xml`,
    host: config.siteUrl,
  };
}
