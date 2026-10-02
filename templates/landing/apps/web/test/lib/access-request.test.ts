import { NextRequest } from "next/server";

import { afterEach, describe, expect, it, vi } from "vitest";

import { forwardAccessRequest } from "@/lib/access-request";

/**
 * The proxy is where the rate limiter's key is chosen, and it had never had a test.
 *
 * The API buckets on the `x-client-ip` header this file forwards, so whatever this file decides to
 * put there **is** the limiter. Until this slice it was the left-most `x-forwarded-for`
 * entry, which behind Cloudflare is a string the caller wrote: rotating it minted a fresh bucket per
 * request and defeated both tiers of `RATE_LIMITS`. That bucket is also the only thing limiting
 * attempts at a six-digit code, so these tests stand under two properties, not one.
 *
 * `NextRequest` is constructed for real rather than cast: it extends `Request` and takes the same
 * constructor, so nothing here has to pretend (CLAUDE.md §5).
 */
type Forwarded = { readonly url: string; readonly headers: Headers; readonly body: string };

/** Stands in for the private-network hop and records what would have crossed it. */
function captureForward(): readonly Forwarded[] {
  const calls: Forwarded[] = [];
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : "",
    });
    return Promise.resolve(Response.json({ token: "signed-token" }));
  });
  return calls;
}

const REQUESTER = { email: "marta@example.com", note: "I keep my goals on paper" } as const;

/**
 * One inbound POST as Next hands it over.
 *
 * `content-length` is set here because undici does not add it for a string body while a real
 * request off the wire always carries one, and the body cap reads it.
 *
 * **It carries three headers that must not survive the hop**, because a fixture that never holds a
 * header worth dropping cannot tell "we chose the right source" from "we forwarded everything and
 * the right one happened to win". A proxy spreading its inbound headers would hand the caller back
 * the forged `x-client-ip` this slice exists to take away, and would put a cookie and a user agent
 * on a request that has no use for either (CLAUDE.md §4.3).
 */
const SMUGGLED = {
  "x-client-ip": "1.2.3.4",
  cookie: "session=marta-secret",
  "user-agent": "Mozilla/5.0 (a requester's browser)",
} as const;

function post(headers: Readonly<Record<string, string>>, body: unknown = REQUESTER): NextRequest {
  const payload = JSON.stringify(body);
  return new NextRequest("http://landing-web/api/access-request/start", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(new TextEncoder().encode(payload).length),
      ...SMUGGLED,
      ...headers,
    },
    body: payload,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the rate limiter's key", () => {
  it("buckets on the address Cloudflare reports, not the one the caller prepended", async () => {
    const forwarded = captureForward();

    await forwardAccessRequest(
      post({
        // Cloudflare appends, so the left-most entry is whatever the caller sent.
        "x-forwarded-for": "198.51.100.66, 203.0.113.7, 10.0.0.2",
        "cf-connecting-ip": "203.0.113.7",
      }),
      "start",
    );

    expect(forwarded[0]?.headers.get("x-client-ip")).toBe("203.0.113.7");
  });

  it("cannot be handed a fresh bucket by rotating x-forwarded-for", async () => {
    // The attack the old code lost to: same caller, a new left-most entry each time, and every
    // request landing in a bucket of its own.
    const forwarded = captureForward();

    await forwardAccessRequest(
      post({ "x-forwarded-for": "1.1.1.1, 203.0.113.7", "cf-connecting-ip": "203.0.113.7" }),
      "start",
    );
    await forwardAccessRequest(
      post({ "x-forwarded-for": "2.2.2.2, 203.0.113.7", "cf-connecting-ip": "203.0.113.7" }),
      "start",
    );

    const keys = forwarded.map((call) => call.headers.get("x-client-ip"));
    expect(keys).toEqual(["203.0.113.7", "203.0.113.7"]);
  });

  it("forwards no client address when Cloudflare reported none", async () => {
    // No header at all is the API falling back to `request.ip`: one tight bucket for everyone,
    // which is the fail-closed direction and what an empty header already did.
    const forwarded = captureForward();

    await forwardAccessRequest(post({}), "start");

    expect(forwarded[0]?.headers.has("x-client-ip")).toBe(false);
  });

  it("does not fall back to x-forwarded-for when cf-connecting-ip is missing", async () => {
    // The request that skipped Cloudflare, or the caller who hopes we still read the chain.
    const forwarded = captureForward();

    await forwardAccessRequest(post({ "x-forwarded-for": "198.51.100.66, 10.0.0.2" }), "start");

    expect(forwarded[0]?.headers.has("x-client-ip")).toBe(false);
    expect(forwarded[0]?.headers.get("x-client-ip")).not.toBe("198.51.100.66");
  });

  it("forwards nothing when the reported address is misshapen or over-long", async () => {
    const refused = [
      "not-an-ip",
      "203.0.113.7, 198.51.100.1",
      "203.0.113.7 198.51.100.1",
      "f".repeat(46),
      "1",
      "   ",
      "203.0.113.7/../x",
    ];
    const forwarded = captureForward();

    for (const value of refused) {
      await forwardAccessRequest(post({ "cf-connecting-ip": value }), "start");
    }

    expect(forwarded).toHaveLength(refused.length);
    for (const call of forwarded) expect(call.headers.has("x-client-ip")).toBe(false);
  });

  it("still forwards the longest address Cloudflare can legitimately report", async () => {
    // The other half of the bound: a shape check tight enough to drop a real IPv6 client would
    // quietly merge every one of them into the shared bucket.
    const addresses = [
      "203.0.113.7",
      "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
      "0000:0000:0000:0000:0000:ffff:255.255.255.255",
    ];
    const forwarded = captureForward();

    for (const address of addresses) {
      await forwardAccessRequest(post({ "cf-connecting-ip": address }), "start");
    }

    expect(forwarded.map((call) => call.headers.get("x-client-ip"))).toEqual(addresses);
  });

  it("forwards no header it was handed, so a caller cannot set its own bucket", async () => {
    // The whole slice in one assertion. `x-client-ip` is the API's rate-limit key, so a proxy that
    // passes inbound headers through gives it straight back to whoever sent it — and the cookie and
    // the user agent are a requester's, with nothing upstream that wants them.
    const forwarded = captureForward();

    await forwardAccessRequest(post({ "cf-connecting-ip": "203.0.113.7" }), "start");
    await forwardAccessRequest(post({}), "start");

    const [reported, unreported] = forwarded;
    expect(reported?.headers.get("x-client-ip")).toBe("203.0.113.7");
    expect(unreported?.headers.has("x-client-ip")).toBe(false);
    for (const call of forwarded) {
      expect(call.headers.has("cookie")).toBe(false);
      expect(call.headers.has("user-agent")).toBe(false);
    }
    // Pinned as a whole set rather than header by header: anything added here later has to be
    // added here deliberately.
    expect([...(reported?.headers.keys() ?? [])].sort()).toEqual(["content-type", "x-client-ip"]);
    expect([...(unreported?.headers.keys() ?? [])].sort()).toEqual(["content-type"]);
  });

  it("trims the reported address, so one client is not two buckets", async () => {
    const forwarded = captureForward();

    await forwardAccessRequest(post({ "cf-connecting-ip": " 203.0.113.7 " }), "start");

    expect(forwarded[0]?.headers.get("x-client-ip")).toBe("203.0.113.7");
  });
});

describe("what reaches the API, and what never does", () => {
  it("puts neither the address nor the note in a header or in the upstream URL", async () => {
    // §4.3: a URL ends up in access logs nobody here controls, and so does a header on a bad day.
    // The body is the one place either may travel.
    const forwarded = captureForward();

    await forwardAccessRequest(post({ "cf-connecting-ip": "203.0.113.7" }), "start");

    const call = forwarded[0];
    expect(call?.url).toBe("http://localhost:4201/access-request/start");
    const headerText = [...(call?.headers ?? new Headers())]
      .map(([name, value]) => `${name}: ${value}`)
      .join("\n");
    // Proves the two assertions below are reading something: an empty header set would pass them
    // without forwarding anything at all.
    expect(headerText).toContain("203.0.113.7");
    expect(headerText).not.toContain("marta");
    expect(headerText).not.toContain("paper");
    expect(call?.body).toContain(REQUESTER.email);
  });

  it("says the API is unavailable without repeating what was submitted", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("connect ECONNREFUSED landing-api")));

    const response = await forwardAccessRequest(
      post({ "cf-connecting-ip": "203.0.113.7" }),
      "start",
    );
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({ error: "mail_unavailable" });
    expect(text).not.toContain("marta");
  });

  it("rejects an unparseable body without echoing it", async () => {
    const forwarded = captureForward();
    const request = new NextRequest("http://landing-web/api/access-request/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"email": "marta@example.com"',
    });

    const response = await forwardAccessRequest(request, "start");
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(text)).toEqual({ error: "invalid_request" });
    expect(text).not.toContain("marta");
    expect(forwarded).toHaveLength(0);
  });
});

describe("the body cap", () => {
  it("refuses a body that declares more than the route's cap, without reading it", async () => {
    const forwarded = captureForward();
    const request = post({ "content-length": "4097", "cf-connecting-ip": "203.0.113.7" });

    const response = await forwardAccessRequest(request, "start");

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(forwarded).toHaveLength(0);
    // Never buffered: the point of capping a hop earlier than the API does.
    expect(request.bodyUsed).toBe(false);
  });

  it("caps each route at the number the API caps it at", async () => {
    // 4 KB on start, 8 KB on verify. One value, refused by one route and carried by the other.
    const forwarded = captureForward();

    const refused = await forwardAccessRequest(post({ "content-length": "6000" }), "start");
    const carried = await forwardAccessRequest(post({ "content-length": "6000" }), "verify");

    expect(refused.status).toBe(413);
    expect(carried.status).toBe(200);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]?.url).toBe("http://localhost:4201/access-request/verify");
  });

  it("does not bound a body whose length is not declared", async () => {
    // Named rather than claimed: a caller who omits `content-length` is bounded by the API's own
    // `bodyLimit` and not by this hop. If that ever changes, this test is the one that says so.
    const forwarded = captureForward();
    const request = new NextRequest("http://landing-web/api/access-request/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(REQUESTER),
    });

    expect(request.headers.get("content-length")).toBeNull();
    const response = await forwardAccessRequest(request, "start");

    expect(response.status).toBe(200);
    expect(forwarded).toHaveLength(1);
  });
});
