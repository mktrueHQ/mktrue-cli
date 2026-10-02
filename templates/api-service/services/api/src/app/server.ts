import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyServerOptions,
} from "fastify";

import type { TokenVerifier } from "../contexts/auth/application/ports";
import { ClerkTokenVerifier } from "../contexts/auth/infrastructure/clerk-token-verifier";
import { DevSessionTokenVerifier } from "../contexts/auth/infrastructure/dev-session-token-verifier";
import { NullTokenVerifier } from "../contexts/auth/infrastructure/null-token-verifier";
import type {
  ExampleItemRepository,
  ExampleNoteRepository,
} from "../contexts/example/application/ports";
import { MongooseExampleItemRepository } from "../contexts/example/infrastructure/mongoose-example-item-repository";
import { MongooseExampleNoteRepository } from "../contexts/example/infrastructure/mongoose-example-note-repository";
import type { UserProfileRepository } from "../contexts/profile/application/ports";
import { MongooseUserProfileRepository } from "../contexts/profile/infrastructure/mongoose-user-profile-repository";
import { registerExampleItemRoutes } from "../controllers/example-items";
import { registerHealthRoute } from "../controllers/health";
import { registerMeRoute } from "../controllers/me";
import { registerProfileRoutes } from "../controllers/profile";
import { registerStatsRoutes } from "../controllers/stats";
import { registerApiErrorHandlers } from "../middlewares/api-errors";
import { requireLoopbackHost } from "../middlewares/require-loopback-host";
import { requireUser } from "../middlewares/require-user";

import { admittedUserIds, config, type ClerkConfig, type DevSessionConfig } from "./config";
import { pathWithoutQuery } from "../middlewares/path-without-query";
import { serializeByUser } from "./serialize-by-user";

export const PUBLIC_ENDPOINTS: ReadonlySet<string> = new Set(["GET /health", "HEAD /health"]);

export interface ServerOverrides {
  readonly tokenVerifier?: TokenVerifier;
  readonly ownerUserId?: string;
  readonly allowedUserIds?: ReadonlySet<string>;
  readonly exampleItemRepository?: ExampleItemRepository;
  readonly exampleNoteRepository?: ExampleNoteRepository;
  readonly userProfileRepository?: UserProfileRepository;
  readonly defaultTimeZone?: string;
  readonly logStream?: NodeJS.WritableStream;
  readonly devSession?: DevSessionConfig;
}

export function buildServer(overrides: ServerOverrides = {}): FastifyInstance {
  const server = Fastify({ logger: selectLogger(overrides.logStream) });

  server.decorateRequest("user", undefined);
  registerApiErrorHandlers(server);

  const devSession = overrides.devSession ?? config.devSession;
  if (devSession) server.addHook("onRequest", requireLoopbackHost());

  const gateOwnerUserId = overrides.ownerUserId ?? config.auth.ownerUserId;
  server.addHook(
    "onRequest",
    requireUser(
      {
        tokenVerifier: overrides.tokenVerifier ?? selectTokenVerifier(config.clerk, devSession),
        ownerUserId: gateOwnerUserId,
        allowedUserIds: admittedUserIds(
          gateOwnerUserId,
          overrides.allowedUserIds ?? config.auth.allowedUserIds,
        ),
      },
      { publicEndpoints: PUBLIC_ENDPOINTS },
    ),
  );

  registerHealthRoute(server);
  registerMeRoute(server);

  const serialize = serializeByUser();

  const userProfileRepository =
    overrides.userProfileRepository ?? new MongooseUserProfileRepository();

  const exampleDeps = {
    exampleItemRepository: overrides.exampleItemRepository ?? new MongooseExampleItemRepository(),
    exampleNoteRepository: overrides.exampleNoteRepository ?? new MongooseExampleNoteRepository(),
    userProfileRepository,
    defaultTimeZone: overrides.defaultTimeZone ?? config.defaultTimeZone,
    serialize,
  };
  registerExampleItemRoutes(server, exampleDeps);
  registerStatsRoutes(server, exampleDeps);

  registerProfileRoutes(server, { userProfileRepository });

  server.addHook("onSend", async (request, reply) => {
    if (!PUBLIC_ENDPOINTS.has(`${request.method} ${request.routeOptions.url ?? ""}`)) {
      reply.header("cache-control", "no-store");
    }
  });

  return server;
}

const REQUEST_LOG_OPTIONS = {
  serializers: {
    req: (request: FastifyRequest) => ({
      method: request.method,
      url: request.routeOptions.url ?? pathWithoutQuery(request.url),
    }),
  },
};

function selectLogger(logStream: ServerOverrides["logStream"]): FastifyServerOptions["logger"] {
  if (logStream) {
    return { ...REQUEST_LOG_OPTIONS, level: "trace", stream: logStream };
  }

  return config.nodeEnv !== "test" ? REQUEST_LOG_OPTIONS : false;
}

export function selectTokenVerifier(
  clerk: ClerkConfig,
  devSession?: DevSessionConfig,
): TokenVerifier {
  if (devSession) return new DevSessionTokenVerifier(devSession);

  if (!clerk.secretKey || !clerk.issuer) {
    return new NullTokenVerifier();
  }

  return new ClerkTokenVerifier({ secretKey: clerk.secretKey, issuer: clerk.issuer });
}
