import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The Mongo integration test starts an in-memory server; the default 5s is not enough on a
    // cold binary download.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
