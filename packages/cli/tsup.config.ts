import { defineConfig } from "tsup";

/**
 * One file, no runtime resolution of workspace packages.
 *
 * `noExternal` is the point: `@mktrue/core` and `@mktrue/contracts` export
 * TypeScript source, so they must be bundled rather than imported at run time.
 * Node's own type stripping will not do it — it does not rewrite a `.js`
 * specifier to the `.ts` file beside it, which is the form NodeNext requires.
 *
 * `dist/mktrue.cjs` is the same entry for the single executable, which runs
 * only CommonJS (decision 0033); the npm package ships `dist/mktrue.js` alone.
 */
export default defineConfig({
  entry: { mktrue: "src/bin.ts" },
  format: ["esm", "cjs"],
  target: "node24",
  platform: "node",
  noExternal: ["@mktrue/core", "@mktrue/contracts", "@mktrue/audit", "@clack/core"],
  removeNodeProtocol: false,
  clean: true,
  banner: ({ format }) => (format === "esm" ? { js: "#!/usr/bin/env node" } : {}),
});
