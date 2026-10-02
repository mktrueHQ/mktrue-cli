import type { MeResponse } from "@__MKTRUE_NAME__/contracts";
import type { FastifyInstance } from "fastify";

import { callerId } from "./caller-id";

export function registerMeRoute(server: FastifyInstance): void {
  server.get("/me", async (request): Promise<MeResponse> => ({ userId: callerId(request) }));
}
