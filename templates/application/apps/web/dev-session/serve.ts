import { spawn } from "node:child_process";
import { createRequire } from "node:module";

import { planDevServer, readWebEnvFiles } from "./bind.ts";

const plan = planDevServer(process.argv.slice(2), process.env, readWebEnvFiles(process.cwd()));

if (plan.kind === "refuse") {
  console.error(plan.reason);
  process.exit(1);
}

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const server = spawn(process.execPath, [next, ...plan.args], {
  stdio: "inherit",
  env: { ...process.env, ...plan.env },
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.kill(signal));
}
server.on("exit", (code) => process.exit(code ?? 1));
