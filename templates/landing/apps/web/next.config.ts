import { resolve } from "node:path";

import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

// Next's own `.env` auto-loading only looks in this package's directory, but the repo keeps one
// `.env` at its root. `NEXT_PUBLIC_*` must be in `process.env` *before* the build so the client
// bundle can inline it. Node's loader never overrides an already-set var, so real platform env
// still wins in production.
try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../.env"));
} catch {
  // No root .env — a fresh clone, or production, where env comes from the platform.
}

/**
 * Response headers on the only origin exposed to the internet.
 *
 * **A real CSP is cheap here precisely because the page has no third-party anything** — no
 * analytics, no tag manager, no CDN script, no embedded frame, and the three webfonts are served
 * from this origin. So `default-src 'self'` holds without a single exception host, and any future
 * attempt to add a tracker breaks visibly instead of quietly making the privacy band a lie.
 *
 * `script-src` carries `'unsafe-inline'`, and that is the one weak directive. Next inlines its
 * bootstrap and RSC payload as inline `<script>` tags; removing this needs per-request nonces,
 * which needs middleware, which turns every static page into a dynamic one. Not worth it for a page
 * whose only script is a three-field form — but it is the honest next step if this ever grows.
 * `object-src 'none'` and `base-uri 'self'` are here because they close the two injection routes
 * that survive `'unsafe-inline'` most usefully.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  // Predates `frame-ancestors`; one line, so both ship.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // `same-origin` rather than strict-origin: there is no cross-origin flow to preserve here — no
  // auth redirect, no payment provider — so nothing is lost by sending no referrer outward at all.
  { key: "Referrer-Policy", value: "same-origin" },
  // Nothing on this page uses any of them.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // No `preload`: that is a promise about every subdomain, and it is the product's to make.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
] as const;

const nextConfig: NextConfig = {
  // Self-contained `.next/standalone` server — a deploy copies just this output plus the static
  // assets, rather than the whole workspace and its node_modules.
  output: "standalone",
  // The workspace root, not this package: without it Next traces from `apps/web` and the standalone
  // build misses files hoisted to the repo-root `node_modules` by pnpm.
  outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: [...SECURITY_HEADERS] }];
  },
};

/**
 * next-intl's build plugin. It is what points the server runtime at `i18n/request.ts`; without it
 * `getTranslations` throws "Couldn't find next-intl config file" at page-data collection, which
 * reads like a missing file rather than a missing plugin.
 *
 * The path is passed explicitly rather than relying on the default lookup, because the default is
 * relative to the directory `next build` runs in and this is a workspace package built from its
 * own directory in dev and may be built from the repo root elsewhere.
 */
export default createNextIntlPlugin("./i18n/request.ts")(nextConfig);
