import type { FastifyReply, FastifyRequest } from "fastify";

import { ProfileStorageUnavailableError } from "../contexts/profile/application/errors";
import { InvalidProfileError } from "../contexts/profile/domain/user-profile";
import { sendApiError } from "../middlewares/api-errors";

export function mapProfileError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (error instanceof ProfileStorageUnavailableError) {
    request.log.error("refused a profile: storage is unavailable");
    return sendApiError(reply, 503, "storage_unavailable", "profile storage is unavailable");
  }

  if (error instanceof InvalidProfileError) {
    request.log.error({ issues: error.issues }, "a stored profile failed domain validation");
    return sendApiError(reply, 500, "internal", "the request could not be completed");
  }

  throw error;
}
