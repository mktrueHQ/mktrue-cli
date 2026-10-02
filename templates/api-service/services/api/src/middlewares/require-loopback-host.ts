import type { FastifyReply, FastifyRequest, onRequestAsyncHookHandler } from "fastify";

import { sendApiError } from "./api-errors";

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function requireLoopbackHost(): onRequestAsyncHookHandler {
  return async function loopbackHostGate(request: FastifyRequest, reply: FastifyReply) {
    // The raw header, not request.host, which honours X-Forwarded-Host.
    if (LOOPBACK_HOSTNAMES.has(hostnameOf(request.headers.host ?? ""))) return;

    return sendApiError(
      reply,
      421,
      "invalid_request",
      "this dev session answers only requests addressed to this machine by a loopback name",
    );
  };
}

function hostnameOf(host: string): string {
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  return host.split(":")[0] ?? "";
}
