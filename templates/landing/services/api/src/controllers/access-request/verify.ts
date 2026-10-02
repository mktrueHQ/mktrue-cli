import {
  verifyAccessRequestBodySchema,
  type VerifyAccessRequestResponse,
} from "@__MKTRUE_NAME__/contracts";
import type { FastifyInstance } from "fastify";

import { verifyAccessRequest } from "../../contexts/access-request/application/verify-access-request";
import { limit } from "../../middlewares/rate-limit";

import type { AccessRequestRouteDeps } from "./deps";
import { mapAccessRequestError } from "./map-error";

/**
 * `POST /access-request/verify` — checks the code, delivers the request to __MKTRUE_OWNER__, stores it.
 *
 * The success body says `verified`, and that word is load-bearing: it means the requester
 * owns the address. It does not mean approved, and nothing downstream of this route can approve
 * anything.
 */
export function registerVerifyRoute(server: FastifyInstance, deps: AccessRequestRouteDeps): void {
  server.post(
    "/access-request/verify",
    { config: limit("verifiesCode"), bodyLimit: 8192 },
    async (request, reply) => {
      const parsed = verifyAccessRequestBodySchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "invalid_code" });

      try {
        await verifyAccessRequest(parsed.data, deps);
        const body: VerifyAccessRequestResponse = { status: "verified" };
        return reply.status(200).send(body);
      } catch (error) {
        return mapAccessRequestError(error, reply);
      }
    },
  );
}
