import type { FastifyReply, FastifyRequest } from "fastify";

import {
  AuthNotConfiguredError,
  AuthUnavailableError,
  InvalidTokenError,
  NotAdmittedError,
} from "../contexts/auth/application/errors";

import { sendApiError } from "./api-errors";

export function mapAuthError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
  challenge: string,
): FastifyReply {
  if (error instanceof InvalidTokenError) {
    reply.header("WWW-Authenticate", challenge);
    return sendApiError(reply, 401, "unauthenticated", "the token was not accepted");
  }

  if (error instanceof NotAdmittedError) {
    return sendApiError(reply, 403, "forbidden", "the authenticated user is not permitted");
  }

  if (error instanceof AuthNotConfiguredError) {
    request.log.debug("refused a gated route: auth is not configured");
  } else if (error instanceof AuthUnavailableError) {
    request.log.warn({ reason: error.message }, "authentication is unavailable");
  } else {
    request.log.error({ err: error }, "the user gate failed unexpectedly");
  }

  return sendApiError(reply, 503, "auth_unavailable", "authentication is unavailable");
}
