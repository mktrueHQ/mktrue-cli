import type { FastifyRequest } from "fastify";

export function callerId(request: FastifyRequest): string {
  if (!request.user) {
    throw new Error("a gated route was reached without a verified principal");
  }

  return request.user.userId;
}
