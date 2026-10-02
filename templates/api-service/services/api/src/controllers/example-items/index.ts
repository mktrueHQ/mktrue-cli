import type { FastifyInstance } from "fastify";

import type { ExampleRouteDeps } from "../deps";

import { registerCreateExampleItemRoute } from "./create";
import { registerListExampleItemsRoute } from "./list";
import { registerExampleNoteRoutes } from "./notes";
import { registerUpdateExampleItemRoute } from "./update";

export function registerExampleItemRoutes(server: FastifyInstance, deps: ExampleRouteDeps): void {
  registerListExampleItemsRoute(server, deps);
  registerCreateExampleItemRoute(server, deps);
  registerUpdateExampleItemRoute(server, deps);
  registerExampleNoteRoutes(server, deps);
}
