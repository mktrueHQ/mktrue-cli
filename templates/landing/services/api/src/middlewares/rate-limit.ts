import { isIP, isIPv6 } from "node:net";

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
 * Per-client ceilings on the two public write routes: an IPv4 address, or an IPv6 /64. Generous on purpose — they bound abuse, they are
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

/** Thrown by the limiter itself, so its 429 cannot be mistaken for a status something else threw. */
export class RateLimited extends Error {
  override readonly name = "RateLimited";
}

/** The eight 16-bit groups of an IPv6 address, its zone dropped. */
function groupsOf(address: string): number[] {
  const [head = "", tail] = (address.split("%")[0] ?? "").split("::");
  const expand = (part: string) =>
    (part === "" ? [] : part.split(":")).flatMap((group) => {
      if (!group.includes(".")) return [Number.parseInt(group, 16)];
      const [a = 0, b = 0, c = 0, d = 0] = group.split(".").map(Number);
      return [a * 256 + b, c * 256 + d];
    });
  const leading = expand(head);
  const trailing = expand(tail ?? "");
  const elided = tail === undefined ? 0 : 8 - leading.length - trailing.length;
  return [...leading, ...Array<number>(elided).fill(0), ...trailing];
}

/**
 * The IPv4 address an IPv6 one carries: IPv4-mapped (`::ffff:a.b.c.d`) or IPv4-compatible
 * (`::a.b.c.d`), however it is written. `::` and `::1` are addresses of their own.
 */
function carriedIPv4(groups: readonly number[]): string | undefined {
  const [high = 0, low = 0] = groups.slice(6);
  const zeros = groups.slice(0, 5).every((group) => group === 0);
  const mapped = groups[5] === 0xffff;
  const compatible = groups[5] === 0 && high * 0x10000 + low > 1;
  if (!zeros || !(mapped || compatible)) return undefined;
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

/**
 * The bucket an address counts in. An IPv4 address is its own bucket, and so is one written as
 * IPv6. Any other IPv6 address counts with its whole /64: that much is one subscriber's to rotate
 * through, so each address in it must not be a fresh allowance.
 */
export function bucketOf(address: string): string {
  if (!isIPv6(address)) return address;

  const groups = groupsOf(address);
  const prefix = groups.slice(0, 4).map((group) => group.toString(16));
  return carriedIPv4(groups) ?? `${prefix.join(":")}::/64`;
}

function clientKey(request: FastifyRequest): string {
  const forwarded = request.headers[CLIENT_IP_HEADER];
  const value = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.trim() ?? "";
  // A forwarded value that is no address would be a bucket of its own, one per spelling.
  return bucketOf(isIP(value) === 0 ? request.ip : value);
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
  await server.register(rateLimitPlugin, {
    global: false,
    keyGenerator: clientKey,
    errorResponseBuilder: () => new RateLimited(),
  });
}
