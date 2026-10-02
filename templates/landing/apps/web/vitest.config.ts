import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // The page is server-rendered to a string in tests; the automatic runtime is what lets a .tsx
  // test file render it without importing React itself.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "."),
      // See the stub for why. The real boundary is enforced by `next build`, not by this.
      "server-only": resolve(import.meta.dirname, "test/test-support/server-only.ts"),
      // next-intl's `createNavigation` imports `next/navigation`, and under pnpm's strict layout
      // that specifier does not resolve from inside next-intl's own nested `node_modules`. Next
      // itself resolves it fine at build time; this only teaches Vitest where to look.
      "next/navigation": resolve(import.meta.dirname, "node_modules/next/navigation.js"),
    },
  },
  test: {
    // Tests mirror `app/` and `lib/` under `test/` — never colocated (CLAUDE.md §6).
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    server: {
      deps: {
        // next-intl ships ESM that imports `next/navigation`, and Vitest externalises the package
        // by default, so the import is resolved by Node from inside next-intl's own nested
        // `node_modules` where pnpm's strict layout has no `next`. Inlining it makes Vite do the
        // resolving, which is what puts the alias above in play.
        inline: ["next-intl"],
      },
    },
  },
});
