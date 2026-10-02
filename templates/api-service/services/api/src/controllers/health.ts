import type { HealthStatus } from "@__MKTRUE_NAME__/contracts";
import type { FastifyInstance } from "fastify";

import { config } from "../app/config";
import { isMongoConnected } from "../contexts/shared/infrastructure/mongo";

export function registerHealthRoute(server: FastifyInstance): void {
  server.get("/health", async (_request, reply): Promise<HealthStatus> => {
    // Set here because the global no-store hook skips public endpoints.
    reply.header("cache-control", "no-store");

    return {
      status: "ok",
      version: config.version,
      ...(config.commitSha ? { commitSha: config.commitSha } : {}),
      mongo: isMongoConnected() ? "connected" : "disconnected",
    };
  });
}
