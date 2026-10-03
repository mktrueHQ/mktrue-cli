// prettier-ignore
import { startAccessRequestBodySchema, type StartAccessRequestResponse } from "@__MKTRUE_NAME__/contracts";
import type { FastifyInstance } from "fastify";

import { startAccessRequest } from "../../contexts/access-request/application/start-access-request";
import { limit } from "../../middlewares/rate-limit";

import type { AccessRequestRouteDeps } from "./deps";
import { mapAccessRequestError } from "./map-error";

/**
 * `POST /access-request/start` — mails a code and returns the pending token. Persists nothing.
 *
 * The response is identical whether or not the address is already in the mailbox or already on
 * __MKTRUE_TITLE__'s whitelist. There is no branch here that could make it otherwise, which is the point:
 * this endpoint must not be usable to enumerate who has access.
 */
export function registerStartRoute(server: FastifyInstance, deps: AccessRequestRouteDeps): void {
  server.post(
    "/access-request/start",
    { config: limit("sendsMail"), bodyLimit: 4096 },
    async (request, reply) => {
      const parsed = startAccessRequestBodySchema.safeParse(request.body);
      // `issues` is deliberately not returned: zod echoes the offending value, which here is an
      // email address.
      if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });

      try {
        const token = await startAccessRequest(parsed.data, deps);
        const body: StartAccessRequestResponse = { token };
        return reply.status(200).send(body);
      } catch (error) {
        return mapAccessRequestError(error, reply);
      }
    },
  );
}
