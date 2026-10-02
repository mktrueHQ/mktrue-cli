import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";

import { loadConfig } from "../../src/app/config";
import { buildServer } from "../../src/app/server";
import { createHmacTokenSigner } from "../../src/contexts/access-request/infrastructure/hmac-token-signer";
import {
  MailDeliveryFailed,
  MailerNotConfigured,
} from "../../src/contexts/access-request/infrastructure/mailers";
import {
  fakeMailer,
  fakeRepository,
  fixedClock,
  fixedCodeGenerator,
  recordingLogger,
  refusingMailer,
  unavailableRepository,
} from "../test-support/fakes";

const AT = new Date("2026-09-09T21:04:00.000Z");
const CODE = "040722";

async function server(overrides = {}) {
  const { mailer, sent } = fakeMailer();
  const { repository, rows } = fakeRepository();
  const { logger } = recordingLogger();

  const app = await buildServer(loadConfig({ NODE_ENV: "test" }), {
    mailer,
    repository,
    logger,
    clock: fixedClock(AT),
    codeGenerator: fixedCodeGenerator(CODE),
    tokenSigner: createHmacTokenSigner("test-secret"),
    destinationEmail: "__MKTRUE_OWNER__@example.com",
    ...overrides,
  });

  return { app, sent, rows };
}

describe("POST /access-request/start", () => {
  it("returns a token", async () => {
    const { app } = await server();
    const res = await app.inject({
      method: "POST",
      url: "/access-request/start",
      payload: { email: "marta@example.com" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("token");
  });

  it("answers 400 on a malformed body, not 500", async () => {
    const { app } = await server();

    for (const payload of [
      {},
      { email: "nope" },
      { email: 42 },
      { email: "a@b.co", note: "x".repeat(501) },
    ]) {
      const res = await app.inject({ method: "POST", url: "/access-request/start", payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it("never echoes the submitted address back", async () => {
    // zod's `issues` include the offending value. Returning them would put the address in the
    // error envelope (CLAUDE.md §4.3).
    const { app } = await server();
    const res = await app.inject({
      method: "POST",
      url: "/access-request/start",
      payload: { email: "marta-is-not-an-address" },
    });

    expect(res.body).not.toContain("marta");
    expect(res.json()).toEqual({ error: "invalid_request" });
  });

  it("fails closed with 503 when mail is unconfigured", async () => {
    const { app } = await server({ mailer: refusingMailer(new MailerNotConfigured()) });
    const res = await app.inject({
      method: "POST",
      url: "/access-request/start",
      payload: { email: "marta@example.com" },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "mail_unavailable" });
  });

  it("answers 503 when the mail provider rejects us, not 500", async () => {
    // Found by running the real image against a bad Resend key. An unmapped provider error fell
    // through to a 500, and the form's copy for an unknown status was "that address does not look
    // right" — blaming the requester for our own outage and sending them off to edit a perfectly
    // good address.
    const { app } = await server({ mailer: refusingMailer(new MailDeliveryFailed("invalid key")) });
    const res = await app.inject({
      method: "POST",
      url: "/access-request/start",
      payload: { email: "marta@example.com" },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "mail_unavailable" });
  });

  it("keeps the provider's message out of the client's response", async () => {
    const { app } = await server({
      mailer: refusingMailer(new MailDeliveryFailed("key re_abc123 is invalid")),
    });
    const res = await app.inject({
      method: "POST",
      url: "/access-request/start",
      payload: { email: "marta@example.com" },
    });

    expect(res.body).not.toContain("re_abc123");
  });

  it("answers 503 when the day's mail budget is spent, and does not blame the address", async () => {
    // A global ceiling is not the caller's fault: every other caller helped reach it. 429 would
    // both misattribute it and promise that waiting an hour helps, which it does not.
    //
    // Four units, because a start costs two: the code mail and the delivery it commits to.
    // So the third request is the one that meets the ceiling.
    const { app, sent } = await server({ dailySendLimit: 4 });
    const send = () =>
      app.inject({
        method: "POST",
        url: "/access-request/start",
        headers: { "x-client-ip": "203.0.113.44" },
        payload: { email: "marta@example.com" },
      });

    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(200);

    const refused = await send();
    expect(refused.statusCode).toBe(503);
    expect(refused.json()).toEqual({ error: "mail_unavailable" });
    expect(refused.body).not.toContain("marta");
    // And critically: no third mail left the building.
    expect(sent.filter((m) => m.kind === "code")).toHaveLength(2);
  });

  it("refuses the sixth request in the window", async () => {
    const { app } = await server();
    const send = () =>
      app.inject({
        method: "POST",
        url: "/access-request/start",
        headers: { "x-client-ip": "203.0.113.9" },
        payload: { email: "marta@example.com" },
      });

    for (let i = 0; i < 5; i += 1) expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(429);
  });

  it("buckets by the forwarded client IP, not the connection", async () => {
    // Every call arrives from the web container, so without this one visitor exhausts the limit
    // for the whole internet.
    const { app } = await server();
    const send = (ip: string) =>
      app.inject({
        method: "POST",
        url: "/access-request/start",
        headers: { "x-client-ip": ip },
        payload: { email: "marta@example.com" },
      });

    for (let i = 0; i < 5; i += 1) await send("198.51.100.1");
    expect((await send("198.51.100.1")).statusCode).toBe(429);
    expect((await send("198.51.100.2")).statusCode).toBe(200);
  });

  it("falls back to one shared bucket when no client address is forwarded", async () => {
    // The other half of an earlier decision, and the assertion that makes the web tier's silence safe: a request
    // that did not arrive through Cloudflare is forwarded with no `x-client-ip` at all, so it keys
    // on `request.ip` — one tight bucket that every such request spends together. Tight is the
    // point. It fails closed and loudly, as the form answering 429, rather than quietly handing out
    // a fresh allowance to anyone who can invent a header.
    const { app } = await server();
    const send = () =>
      app.inject({
        method: "POST",
        url: "/access-request/start",
        payload: { email: "marta@example.com" },
      });

    for (let i = 0; i < 5; i += 1) expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(429);
  });
});

describe("POST /access-request/verify", () => {
  async function tokenFor(app: FastifyInstance, email = "marta@example.com") {
    const res = await app.inject({
      method: "POST",
      url: "/access-request/start",
      payload: { email },
    });
    return res.json<{ token: string }>().token;
  }

  it("verifies, and says verified rather than approved", async () => {
    const { app, rows } = await server();
    const res = await app.inject({
      method: "POST",
      url: "/access-request/verify",
      payload: { token: await tokenFor(app), code: CODE },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "verified" });
    expect(rows.size).toBe(1);
  });

  it("gives a wrong code and an invalid token the same answer", async () => {
    // Distinguishing them tells an attacker whether a token is still live.
    const { app } = await server();
    const wrongCode = await app.inject({
      method: "POST",
      url: "/access-request/verify",
      payload: { token: await tokenFor(app), code: "000000" },
    });
    const badToken = await app.inject({
      method: "POST",
      url: "/access-request/verify",
      payload: { token: "forged.token", code: CODE },
    });

    expect(wrongCode.statusCode).toBe(400);
    expect(badToken.statusCode).toBe(400);
    expect(wrongCode.body).toEqual(badToken.body);
  });

  it("answers a replayed verify exactly as it answered the first", async () => {
    // No oracle for whether a token has been used: same status, same body, byte for byte. Behind
    // that identical answer the replay sends nothing and writes nothing — which is the
    // whole shape of the fix, invisible from the browser and load-bearing on the inside.
    const { app, sent, rows } = await server();
    const payload = { token: await tokenFor(app), code: CODE };

    const first = await app.inject({ method: "POST", url: "/access-request/verify", payload });
    const replay = await app.inject({ method: "POST", url: "/access-request/verify", payload });

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(first.statusCode);
    expect(replay.body).toEqual(first.body);
    expect(sent.filter((mail) => mail.kind === "delivery")).toHaveLength(1);
    expect(rows.size).toBe(1);
  });

  it("answers 400 on a code that is not six digits", async () => {
    const { app } = await server();

    for (const code of ["12345", "abcdef", "", "1234567"]) {
      const res = await app.inject({
        method: "POST",
        url: "/access-request/verify",
        payload: { token: "x.y", code },
      });
      expect(res.statusCode, code).toBe(400);
    }
  });
});

describe("GET /health", () => {
  it("reports status without counting anything personal", async () => {
    const { app } = await server();
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json())).toEqual(["status", "version", "commit"]);
  });
});

describe("logging", () => {
  it("redacts an address and a token digest out of a failed claim", async () => {
    // Mongo's errors quote the values they failed on. Passing one straight to the logger writes a
    // requester's address into the log — the one leak that arrives through a path that looks safe,
    // because the seam's `code` argument is already fixed. The claim query filters on both
    // the address *and* the token digest, so a driver error can now carry either, and the digest
    // identifies one person's request as precisely as the address does.
    //
    // The rejection below is shaped like a real one on purpose: an assertion against
    // `new Error("mongo is down")` would pass against an implementation that logged the lot.
    const digest = "a3f1".repeat(16);
    const lines: string[] = [];
    const { mailer } = fakeMailer();
    const app = await buildServer(loadConfig({ NODE_ENV: "test" }), {
      mailer,
      clock: fixedClock(AT),
      codeGenerator: fixedCodeGenerator(CODE),
      tokenSigner: createHmacTokenSigner("test-secret"),
      destinationEmail: "__MKTRUE_OWNER__@example.com",
      repository: unavailableRepository(
        new Error(
          "E11000 duplicate key error collection: __MKTRUE_NAME__.access_requests " +
            `dup key: { email: "marta@example.com", tokenDigests: "${digest}" }`,
        ),
      ),
    });
    app.log.error = ((obj: unknown) => {
      lines.push(JSON.stringify(obj));
    }) as typeof app.log.error;

    const started = await app.inject({
      method: "POST",
      url: "/access-request/start",
      payload: { email: "marta@example.com" },
    });
    await app.inject({
      method: "POST",
      url: "/access-request/verify",
      payload: { token: started.json<{ token: string }>().token, code: CODE },
    });

    expect(lines.join(" ")).not.toContain("marta@example.com");
    expect(lines.join(" ")).not.toContain(digest);
    expect(lines.join(" ")).toContain("[address]");
    expect(lines.join(" ")).toContain("[digest]");
  });
});
