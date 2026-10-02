import { defineConfig } from "tsup";

export default defineConfig({
  // The object form pins the output to dist/main.js, which the start script names.
  entry: { main: "src/app/main.ts" },
  format: ["esm"],
  platform: "node",
  target: "node24",
  clean: true,
  noExternal: ["@__MKTRUE_NAME__/contracts"],
});
