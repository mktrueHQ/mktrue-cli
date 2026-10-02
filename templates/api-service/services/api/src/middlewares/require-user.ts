import type { onRequestAsyncHookHandler, FastifyReply, FastifyRequest } from "fastify";

import { NotAdmittedError } from "../contexts/auth/application/errors";
import type { AuthenticatedUser, TokenVerifier } from "../contexts/auth/application/ports";

import { sendApiError } from "./api-errors";
import { extractBearerToken } from "./extract-bearer-token";
import { mapAuthError } from "./map-auth-error";

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

export interface UserGateDeps {
  readonly tokenVerifier: TokenVerifier;
  readonly ownerUserId?: string;
  readonly allowedUserIds: ReadonlySet<string>;
}

export interface UserGatePolicy {
  readonly publicEndpoints: ReadonlySet<string>;
}

export function requireUser(deps: UserGateDeps, policy: UserGatePolicy): onRequestAsyncHookHandler {
  return async function userGate(request: FastifyRequest, reply: FastifyReply) {
    if (isPublic(request, policy)) return;

    if (!deps.ownerUserId) {
      sendApiError(reply, 503, "auth_unavailable", "authentication is unavailable");
      return;
    }

    const challenge = "Bearer";

    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      reply.header("WWW-Authenticate", challenge);
      sendApiError(reply, 401, "unauthenticated", "the request carried no bearer token");
      return;
    }

    try {
      const user = await deps.tokenVerifier.verify(token);
      if (!deps.allowedUserIds.has(user.userId)) {
        request.log.warn("a verified principal was refused: not on the whitelist");
        throw new NotAdmittedError();
      }
      request.user = user;
    } catch (error: unknown) {
      mapAuthError(request, reply, error, challenge);
    }
  };
}

function isPublic(request: FastifyRequest, policy: UserGatePolicy): boolean {
  const route = request.routeOptions.url;
  return route !== undefined && policy.publicEndpoints.has(`${request.method} ${route}`);
}
