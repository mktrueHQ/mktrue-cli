import type { FastifyReply, FastifyRequest } from "fastify";

import {
  ExampleItemNotFoundError,
  ExampleStorageUnavailableError,
  TooManyExampleNotesError,
} from "../contexts/example/application/errors";
import { InvalidExampleItemError } from "../contexts/example/domain/example-item";
import { InvalidExampleNoteError } from "../contexts/example/domain/example-note";
import { ProfileStorageUnavailableError } from "../contexts/profile/application/errors";
import { sendApiError } from "../middlewares/api-errors";

export function mapExampleError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (error instanceof ExampleItemNotFoundError) {
    return sendApiError(reply, 404, "not_found", "no such example item");
  }

  if (error instanceof TooManyExampleNotesError) {
    return sendApiError(reply, 409, "conflict", "this item already holds as many notes as it may");
  }

  if (
    error instanceof ExampleStorageUnavailableError ||
    error instanceof ProfileStorageUnavailableError
  ) {
    request.log.error("refused an example route: storage is unavailable");
    return sendApiError(reply, 503, "storage_unavailable", "storage is unavailable");
  }

  if (error instanceof InvalidExampleItemError || error instanceof InvalidExampleNoteError) {
    request.log.error({ issues: error.issues }, "a stored example row failed domain validation");
    return sendApiError(reply, 500, "internal", "the request could not be completed");
  }

  throw error;
}
