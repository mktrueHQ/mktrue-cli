import type { FastifyInstance } from "fastify";

import type { ExampleRouteDeps } from "../deps";

import { registerExampleStatsRoute } from "./example-items";

export function registerStatsRoutes(server: FastifyInstance, deps: ExampleRouteDeps): void {
  registerExampleStatsRoute(server, deps);
}
