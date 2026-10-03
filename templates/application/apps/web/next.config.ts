import { resolve } from "node:path";

import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { DEV_SESSION_WARNING, devSessionAliases } from "./dev-session/aliases";

try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../.env"));
} catch {
  // No root .env: a fresh clone, or an image whose environment comes from the platform.
}

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
] as const;

const baseConfig: NextConfig = {
  // prettier-ignore
  transpilePackages: ["@__MKTRUE_NAME__/contracts"],
  output: "standalone",
  outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
  agentRules: false,
  poweredByHeader: false,
  headers: async () => [{ source: "/:path*", headers: [...SECURITY_HEADERS] }],
};

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

export default function nextConfig(phase: string): NextConfig {
  const aliases = devSessionAliases(phase, process.env);
  if (Object.keys(aliases).length === 0) return withNextIntl(baseConfig);

  console.warn(DEV_SESSION_WARNING);
  return withNextIntl({ ...baseConfig, turbopack: { resolveAlias: { ...aliases } } });
}
