import Fastify, { errorCodes, type FastifyInstance, type FastifyRequest } from "fastify";

import { registerAccessRequestRoutes } from "../controllers/access-request";
import type { AccessRequestRouteDeps } from "../controllers/access-request/deps";
import { createHmacTokenSigner } from "../contexts/access-request/infrastructure/hmac-token-signer";
import { createInMemoryWrongCodeCounter } from "../contexts/access-request/infrastructure/in-memory-wrong-code-counter";
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
import { RateLimited, registerRateLimit } from "../middlewares/rate-limit";
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
 * **So the message is not logged at all: the error's name and its code are.** A pattern can redact
 * an address and a digest, and not a note, which has no shape. A JSON parse error quotes the body
 * it failed on. The name and the code (`11000`, `ECONNREFUSED`) say which failure it was; nothing
 * typed by a visitor can be either.
 */
export function safeErrorSummary(error: unknown): { name: string; code?: string } {
  const name = error instanceof Error ? error.name : typeof error;
  const raw =
    typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  const code = typeof raw === "number" || typeof raw === "string" ? String(raw) : "";
  return /^[A-Za-z0-9_]{1,40}$/.test(code) ? { name, code } : { name };
}

/**
 * The refusals Fastify itself makes of a request, before a handler runs. Only these choose a status:
 * a `statusCode` on anything else was put there by a provider or a driver.
 */
const REFUSED_BY_FASTIFY = [
  [errorCodes.FST_ERR_CTP_INVALID_JSON_BODY, 400],
  [errorCodes.FST_ERR_CTP_EMPTY_JSON_BODY, 400],
  [errorCodes.FST_ERR_CTP_INVALID_CONTENT_LENGTH, 400],
  [errorCodes.FST_ERR_CTP_BODY_TOO_LARGE, 413],
  [errorCodes.FST_ERR_CTP_INVALID_MEDIA_TYPE, 415],
] as const;

/** A route schema's refusal is a plain error Fastify marks, so it is known by the marks. */
function refusedBySchema(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "FST_ERR_VALIDATION" &&
    "validation" in error &&
    Array.isArray(error.validation)
  );
}

function refusalStatus(error: unknown): number | undefined {
  if (refusedBySchema(error)) return 400;
  return REFUSED_BY_FASTIFY.find(([kind]) => error instanceof kind)?.[1];
}

/** Where the log's lines go. A test passes one to read what a whole flow wrote. */
export interface LogStream {
  write(line: string): void;
}

/**
 * Nothing this API logs carries a body, and the only PII in a body is the requester's address
 * (CLAUDE.md §4.3). `redact` is belt-and-braces for headers.
 *
 * The request line names the route that matched, never the URL: a query string or a path nobody
 * registered is text a stranger typed.
 */
const LOG_OPTIONS = {
  redact: ["req.headers.authorization", "req.headers.cookie"],
  serializers: {
    req: (request: FastifyRequest) => ({
      method: request.method,
      url: request.routeOptions?.url ?? "unmatched",
    }),
  },
};

export async function buildServer(
  config: ApiConfig,
  overrides: ServerOverrides = {},
  logStream?: LogStream,
): Promise<FastifyInstance> {
  const server = Fastify({
    logger:
      logStream !== undefined
        ? { ...LOG_OPTIONS, stream: logStream }
        : config.isTest
          ? false
          : LOG_OPTIONS,
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

  // Fastify's own handler logs an error's message and sends it to the client. A body that is not
  // JSON is quoted in its parse error, and an error thrown by a mail provider or a driver may quote
  // an address: so every error leaves as a fixed body, and is logged by name and code.
  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof RateLimited) {
      server.log.info(safeErrorSummary(error), "request.rate_limited");
      return reply.status(429).send({ error: "rate_limited" });
    }

    const refusal = refusalStatus(error);
    if (refusal !== undefined) return reply.status(refusal).send({ error: "invalid_request" });

    server.log.error(safeErrorSummary(error), "request.failed");
    return reply.status(500).send({ error: "internal_error" });
  });

  // Fastify's own answer to an unknown route quotes the URL, query included, in the body and in a
  // log line of its own.
  server.setNotFoundHandler((_request, reply) => reply.status(404).send({ error: "not_found" }));

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
    // The fallback is only reached where no real mail is sent: config.ts refuses a blank secret
    // beside a mail key. It is fixed because a random one per restart would end a token mid-flow.
    tokenSigner: createHmacTokenSigner(config.tokenSecret ?? "development-only-unsafe-secret"),
    clock: systemClock,
    codeGenerator: randomCodeGenerator,
    repository: mongooseAccessRequestRepository,
    // Without a database the ceiling can only be per-process, and it resets on restart — stated in
    // the adapter rather than hidden. With one, it is durable and survives a redeploy.
    sendBudget: config.mongoUri === undefined ? createInMemorySendBudget() : mongooseSendBudget,
    dailySendLimit: config.dailySendLimit,
    verificationMemory: config.verificationMemory,
    // Sized as the replay memory is: the send budget lets no more tokens than that be alive at once.
    wrongCodes: createInMemoryWrongCodeCounter(config.verificationMemory),
    logger: { error: (code, error) => server.log.error(safeErrorSummary(error), code) },
    destinationEmail: config.destinationEmail ?? "",
    ...overrides,
  };

  registerAccessRequestRoutes(server, deps);

  return server;
}
