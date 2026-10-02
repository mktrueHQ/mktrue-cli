import type { FastifyReply, FastifyRequest } from "fastify";
import type { ZodError } from "zod";

import { sendApiError } from "../middlewares/api-errors";

export function rejectInvalidRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  error: ZodError,
  message: string,
): FastifyReply {
  const issues = error.issues.map((issue) => `${issue.path.join(".")}:${issue.code}`);
  request.log.info({ issues }, "a request failed its contract schema");
  return sendApiError(reply, 400, "invalid_request", message);
}
