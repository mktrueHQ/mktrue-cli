import { resolve } from "node:path";

import mongoose from "mongoose";

import { loadConfig } from "./config";
import { buildServer } from "./server";

// The repo keeps one `.env` at its root. Node's loader never overrides an already-set var, so the
// platform's real environment still wins in production.
try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../../.env"));
} catch {
  // No root .env — production, where env comes from the platform.
}

const config = loadConfig();
const server = await buildServer(config);

/**
 * Mongo is connected **without blocking the boot**.
 *
 * Persistence is best-effort by design (see `verify-access-request.ts`): the delivered email is
 * what __MKTRUE_OWNER__ acts on, so a database that is slow to come up must not stop the API answering. A
 * failed connection is logged and the flow still mails; the write is what degrades.
 */
if (config.mongoUri !== undefined) {
  mongoose
    .connect(config.mongoUri, { dbName: config.mongoDbName })
    .catch((error: unknown) => server.log.error({ err: error }, "mongo.connect_failed"));
}

server.listen({ port: config.port, host: config.host }).catch((error: unknown) => {
  server.log.error({ err: error }, "server.listen_failed");
  process.exit(1);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void (async () => {
      await server.close();
      await mongoose.disconnect();
      process.exit(0);
    })();
  });
}
