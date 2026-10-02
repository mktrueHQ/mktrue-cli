import type { FastifyInstance } from "fastify";

import type { ProfileRouteDeps } from "../deps";

import { registerReadProfileRoute } from "./read";
import { registerUpdateProfileRoute } from "./update";

export function registerProfileRoutes(server: FastifyInstance, deps: ProfileRouteDeps): void {
  registerReadProfileRoute(server, deps);
  registerUpdateProfileRoute(server, deps);
}
