import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // The in-memory Mongo downloads its binary on first run and needs time to elect a primary.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@api": `${import.meta.dirname}/src`,
    },
  },
});
