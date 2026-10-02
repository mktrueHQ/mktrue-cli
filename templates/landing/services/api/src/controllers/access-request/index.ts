import type { FastifyInstance } from "fastify";

import type { AccessRequestRouteDeps } from "./deps";
import { registerStartRoute } from "./start";
import { registerVerifyRoute } from "./verify";

/** The whole write surface of this API: two routes, both rate-limited, both body-capped. */
export function registerAccessRequestRoutes(
  server: FastifyInstance,
  deps: AccessRequestRouteDeps,
): void {
  registerStartRoute(server, deps);
  registerVerifyRoute(server, deps);
}
