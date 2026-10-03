// prettier-ignore
import type { ApiError, ApiErrorCode } from "@__MKTRUE_NAME__/contracts";
import type { FastifyError, FastifyInstance, FastifyReply } from "fastify";

import { pathWithoutQuery } from "./path-without-query";

export function sendApiError(
  reply: FastifyReply,
  status: number,
  code: ApiErrorCode,
  message: string,
): FastifyReply {
  const body: ApiError = { error: { code, message } };
  return reply.code(status).send(body);
}

export function registerApiErrorHandlers(server: FastifyInstance): void {
  server.setNotFoundHandler((request, reply) => {
    request.log.info(
      { method: request.method, url: pathWithoutQuery(request.url) },
      "no route matched",
    );
    return sendApiError(reply, 404, "not_found", "no route matched this request");
  });

  server.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;

    if (status >= 500 || status < 400) {
      request.log.error({ err: error }, "request failed");
      return sendApiError(reply, 500, "internal", "the request could not be completed");
    }

    return sendApiError(reply, status, "invalid_request", describeClientError(error));
  });
}

function describeClientError(error: FastifyError): string {
  // The framework's own prefix, not any `code`: a Node system error's message names hosts and ports.
  const isFrameworkError = error.validation !== undefined || error.code?.startsWith("FST_ERR_");
  return isFrameworkError && error.message ? error.message : "the request could not be processed";
}
