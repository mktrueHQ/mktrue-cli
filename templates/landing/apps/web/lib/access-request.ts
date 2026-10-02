import "server-only";

import type { NextRequest } from "next/server";

import { config } from "./config";

/** The header the API's rate limiter buckets on. See `services/api/src/middlewares/rate-limit.ts`. */
const CLIENT_IP_HEADER = "x-client-ip";

/**
 * What an address has to look like before it is allowed to become a rate-limit bucket: hex digits,
 * dots and colons, three to forty-five characters. Forty-five is an IPv6 address with an embedded
 * IPv4 tail, which is the longest thing Cloudflare can legitimately report.
 *
 * Not a parser, and not trying to be: the API keys an in-memory map on this value, so what matters
 * is that an eight-kilobyte header, a chain with a comma in it, or anything else a caller managed to
 * get in front of us is refused before it can become a key.
 */
const CLIENT_IP_SHAPE = /^[0-9a-f.:]{3,45}$/i;

/** Mirrors the API's per-route `bodyLimit`, so whichever tier refuses first refuses the same thing. */
const BODY_CAPS = { start: 4096, verify: 8192 } as const;

/**
 * The address Cloudflare says the request came from, or nothing at all.
 *
 * Cloudflare sets `cf-connecting-ip` itself and strips any copy the caller sent, so it is a single
 * address with no chain and nothing to prepend to.
 */
function reportedClientIp(request: NextRequest): string | undefined {
  const reported = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  return CLIENT_IP_SHAPE.test(reported) ? reported : undefined;
}

/**
 * Forwards one access-request call to the API over the private network.
 *
 * The real client address is passed on explicitly, because every call the API sees originates from
 * this container: without it the limiter would bucket the entire internet together and throttle
 * everyone at once.
 *
 * It comes from `cf-connecting-ip` and from nowhere else. It used to come from the
 * left-most `x-forwarded-for` entry, which was attacker-chosen: Cloudflare **appends** the
 * connecting address to whatever chain arrived, so the chain reads `<what the caller wrote>, <the
 * real client>, <Traefik's peer>`, and rotating that first string minted a fresh bucket per request.
 * The right-most entry would be honest only while the chain is exactly one hop long after
 * Cloudflare, which is a fact about a proxy this repo neither owns nor can test.
 *
 * Absent or misshapen, nothing is forwarded rather than a guess, and the API's limiter falls back to
 * `request.ip` — one tight bucket shared by every visitor. That is the fail-closed direction
 * (CLAUDE.md §4.5), it is the behaviour an empty header already had, and it is reached only when a
 * request did not arrive through Cloudflare. **So the limiter's honesty now rests on the origin
 * being unreachable except through Cloudflare**, which is __MKTRUE_NAME__-infrastructure's to enforce and
 * `docs/deploy.md`'s to record.
 *
 * The API's response is passed through untouched — status and body. Both are already free of the
 * submitted address by construction (`map-error.ts`), so there is nothing here to sanitise, and
 * re-mapping them would be a second copy of the same decision.
 */
export async function forwardAccessRequest(
  request: NextRequest,
  path: "start" | "verify",
): Promise<Response> {
  // Refuse an oversized body here rather than buffering it and letting the API's `bodyLimit` reject
  // it a hop later. It bounds the declared length only: a caller who sends no `content-length`, or
  // chunks the body, is bounded by the API's cap and not by this.
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > BODY_CAPS[path]) {
    return Response.json({ error: "invalid_request" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const clientIp = reportedClientIp(request);

  try {
    const upstream = await fetch(`${config.apiBaseUrl}/access-request/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(clientIp === undefined ? {} : { [CLIENT_IP_HEADER]: clientIp }),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    // The API is unreachable. Say so as an unavailability rather than a rejection: the requester
    // did nothing wrong and should try again, not edit their address.
    return Response.json({ error: "mail_unavailable" }, { status: 503 });
  }
}
