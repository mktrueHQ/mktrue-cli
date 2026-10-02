import Fastify, { type FastifyInstance } from "fastify";

import { registerAccessRequestRoutes } from "../controllers/access-request";
import type { AccessRequestRouteDeps } from "../controllers/access-request/deps";
import { createHmacTokenSigner } from "../contexts/access-request/infrastructure/hmac-token-signer";
import {
  consoleMailer,
  createResendMailer,
  nullMailer,
} from "../contexts/access-request/infrastructure/mailers";
import { mongooseAccessRequestRepository } from "../contexts/access-request/infrastructure/mongoose-access-request-repository";
import {
  createInMemorySendBudget,
  mongooseSendBudget,
} from "../contexts/access-request/infrastructure/mongoose-send-budget";
import { randomCodeGenerator } from "../contexts/access-request/infrastructure/random-code-generator";
import { systemClock } from "../contexts/access-request/infrastructure/system-clock";
import { registerRateLimit } from "../middlewares/rate-limit";
import type { ApiConfig } from "./config";
import type { Mailer } from "../contexts/access-request/application/ports";

/** Test seam: every port can be replaced, so the routes run without Mongo, Resend or a real clock. */
export type ServerOverrides = Partial<AccessRequestRouteDeps>;

/**
 * Mail adapter selection — the one place fail-closed is decided (CLAUDE.md §4.5).
 *
 * With a key: the real thing. Without one, **development** gets the console mailer so the flow can
 * be walked end to end, and **production** gets the null mailer, which refuses with 503. The
 * console mailer must never be reachable in production: a "sent" that went to stdout is a request
 * lost behind a success message.
 */
function selectMailer(config: ApiConfig): Mailer {
  if (config.resendApiKey !== undefined && config.mailFrom !== undefined) {
    return createResendMailer(config.resendApiKey, config.mailFrom);
  }
  return config.isProduction ? nullMailer : consoleMailer;
}

/**
 * What the `Logger` seam is allowed to put in a log line.
 *
 * The seam takes a fixed `code` so a caller cannot slip an address into the message — but the
 * *error object* is the hole that leaves. Mongo's duplicate-key error embeds the offending value
 * verbatim (`E11000 ... dup key: { email: "someone@example.com" }`), and passing that straight to
 * `log.error({ err })` writes a requester's address into the log the moment a write conflicts.
 * That is the exact thing CLAUDE.md §4.3 forbids, arriving through the one path that looks safe.
 *
 * So the message is kept — a persistence failure is worth debugging — with anything shaped like an
 * address replaced first. Deliberately greedy: over-redacting a log line costs nothing, and the
 * alternative is trusting every error type this seam will ever see.
 *
 * **A token digest is redacted on the same grounds.** It identifies one person's access request as
 * precisely as the address does, it is what the claim query fails on, and a driver error
 * quotes the filter it could not run. Any 64-character hex string goes, which over-redacts by
 * design: nothing else this seam prints in that shape is worth more than the risk.
 */
function safeErrorSummary(error: unknown): { name: string; message: string } {
  const name = error instanceof Error ? error.name : typeof error;
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/[^\s@"']+@[^\s@"']+\.[^\s@"',}]+/g, "[address]")
    .replace(/\b[0-9a-f]{64}\b/gi, "[digest]");
  return { name, message };
}

export async function buildServer(
  config: ApiConfig,
  overrides: ServerOverrides = {},
): Promise<FastifyInstance> {
  const server = Fastify({
    // The request logger is on, but nothing this API logs carries a body — and the only PII in a
    // body is the requester's address (CLAUDE.md §4.3). `redact` is belt-and-braces for headers.
    logger: config.isTest ? false : { redact: ["req.headers.authorization", "req.headers.cookie"] },
    // `false` because the API is private. It never sees a real client address, so there is
    // no proxy chain to trust — the limiter keys off the header the web tier forwards instead, and
    // pretending otherwise would hand it a value it cannot validate.
    trustProxy: false,
  });

  // **Awaited, and the await is load-bearing.** `@fastify/rate-limit` attaches per-route limits
  // through an `onRoute` hook, and with `global: false` that hook only fires for routes registered
  // *after* the plugin has finished loading. Registering without awaiting queues the plugin until
  // `ready()` — by which time every route below is already in place, so the limiter attaches to
  // nothing and both public write routes run uncapped. It fails silently: the routes answer 200
  // forever and only a test that actually exceeds the ceiling notices.
  await registerRateLimit(server);

  // No CORS plugin anywhere, and that is the design: the browser never calls this service,
  // so there is no cross-origin request to permit. A CORS config here would be the first sign
  // someone had pointed a browser at it.

  server.get("/health", async () => ({
    status: "ok",
    version: config.version,
    commit: config.commitSha,
  }));

  const deps: AccessRequestRouteDeps = {
    mailer: selectMailer(config),
    // A blank secret cannot reach production (config.ts refuses the boot), so the dev fallback is
    // only ever used by a keyless local clone — where a fixed string is fine and a random one per
    // restart would invalidate a token mid-flow.
    tokenSigner: createHmacTokenSigner(config.tokenSecret ?? "development-only-unsafe-secret"),
    clock: systemClock,
    codeGenerator: randomCodeGenerator,
    repository: mongooseAccessRequestRepository,
    // Without a database the ceiling can only be per-process, and it resets on restart — stated in
    // the adapter rather than hidden. With one, it is durable and survives a redeploy.
    sendBudget: config.mongoUri === undefined ? createInMemorySendBudget() : mongooseSendBudget,
    dailySendLimit: config.dailySendLimit,
    verificationMemory: config.verificationMemory,
    logger: { error: (code, error) => server.log.error(safeErrorSummary(error), code) },
    destinationEmail: config.destinationEmail ?? "",
    ...overrides,
  };

  registerAccessRequestRoutes(server, deps);

  return server;
}
