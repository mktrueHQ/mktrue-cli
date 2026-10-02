import rateLimitPlugin from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";

/**
 * The header the web tier forwards the **real** client IP in.
 *
 * Every call to this API arrives from the landing page's own Next server — the browser
 * never talks to it — so `request.ip` is one address for the entire internet. Keying the limiter on
 * that would throttle every visitor at once instead of the one abusing it: precisely the outage the
 * limiter exists to prevent.
 *
 * Trusting a client-supplied header is normally a mistake. It is sound here **only** because this
 * API is private: it publishes no port, joins no ingress network, and nothing outside the compose
 * project can reach it to forge this. **If it is ever given a public router, this must change in
 * the same commit.**
 */
export const CLIENT_IP_HEADER = "x-client-ip";

/**
 * Per-IP ceilings on the two public write routes. Generous on purpose — they bound abuse, they are
 * not a UX constraint, and no honest requester will ever meet one.
 *
 * `sendsMail` is the one that matters: it puts mail in a stranger's inbox on request. Resend's free
 * tier is 100 emails a day, so an unbounded start route takes the form down for everyone as a side
 * effect of being abused.
 */
export const RATE_LIMITS = {
  /** `POST /access-request/start` — mails a code to an address a stranger typed. */
  sendsMail: { max: 5, timeWindow: "1 hour" },
  /** `POST /access-request/verify` — checks a six-digit code, so it is brute-forceable. */
  verifiesCode: { max: 20, timeWindow: "1 hour" },
} as const;

export type RateLimitTier = keyof typeof RATE_LIMITS;

/** Route-level opt-in: `server.post(path, { config: limit("sendsMail") }, handler)`. */
export function limit(tier: RateLimitTier) {
  return { rateLimit: RATE_LIMITS[tier] };
}

function clientKey(request: FastifyRequest): string {
  const forwarded = request.headers[CLIENT_IP_HEADER];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return value?.trim() || request.ip;
}

/**
 * Registered with `global: false`: it applies to routes that opt in via `limit()` and nothing else,
 * so `/health` stays open for the container healthcheck.
 *
 * In-memory, deliberately. One API container, so a shared store would mean adding Redis to a repo
 * that does not want it. The honest cost: restarting the API forgets its counters, and a
 * horizontally-scaled API would count per instance. Neither is true today; both are reasons to
 * revisit rather than surprises.
 */
export async function registerRateLimit(server: FastifyInstance): Promise<void> {
  await server.register(rateLimitPlugin, { global: false, keyGenerator: clientKey });
}
