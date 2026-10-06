import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";

import { loadConfig } from "../../src/app/config";
import { buildServer, safeErrorSummary, type ServerOverrides } from "../../src/app/server";
import type { Mailer } from "../../src/contexts/access-request/application/ports";
import { createHmacTokenSigner } from "../../src/contexts/access-request/infrastructure/hmac-token-signer";
import { MailDeliveryFailed } from "../../src/contexts/access-request/infrastructure/mailers";
import {
  fakeMailer,
  fakeRepository,
  fixedClock,
  fixedCodeGenerator,
  unavailableRepository,
} from "../test-support/fakes";

/**
 * The log rule, proved by reading the log: every line the service's own logger writes across the
 * whole flow, request lines included, searched for what a visitor typed.
 */
const AT = new Date("2026-09-09T21:04:00.000Z");
const CODE = "040722";
const BODY = { email: "marta@example.com", note: "I want to see the undo log." } as const;
// prettier-ignore
const DESTINATION = "__MKTRUE_OWNER__@example.com";
const signer = createHmacTokenSigner("test-secret");

/** What must be in no line: the address, the note, the destination's address. */
const TYPED = /marta|undo log|example\.com/i;

/** What a refused body held, or what a parser says of one: in no line either. */
const REFUSED_BODY = /undo|xml|JSON|content-length|required property/i;

/** A provider or a driver quoting what it failed on, as the real ones do. */
const QUOTING = 'failed on { email: "marta@example.com", note: "I want to see the undo log." }';

function logged() {
  const lines: string[] = [];
  const build = (overrides: ServerOverrides = {}) =>
    buildServer(
      loadConfig({ NODE_ENV: "test" }),
      {
        mailer: fakeMailer().mailer,
        repository: fakeRepository().repository,
        clock: fixedClock(AT),
        codeGenerator: fixedCodeGenerator(CODE),
        tokenSigner: signer,
        destinationEmail: DESTINATION,
        ...overrides,
      },
      { write: (line) => lines.push(line) },
    );
  return { lines, build };
}

const post = (app: FastifyInstance, path: "start" | "verify", payload: unknown, ip: string) =>
  app.inject({
    method: "POST",
    url: `/access-request/${path}`,
    headers: { "x-client-ip": ip, "content-type": "application/json" },
    payload: typeof payload === "string" ? payload : JSON.stringify(payload),
  });

const failingCodeMail = (error: Error): Mailer => ({
  sendVerificationCode: () => Promise.reject(error),
  deliverAccessRequest: () => Promise.resolve(),
});

const failingDelivery = (error: Error): Mailer => ({
  sendVerificationCode: () => Promise.resolve(),
  deliverAccessRequest: () => Promise.reject(error),
});

describe("what is logged of an error", () => {
  it("is its name and a code of plain shape, never its message", () => {
    const driver = Object.assign(new Error("connect ECONNREFUSED db.internal:27017"), {
      name: "MongoNetworkError",
      code: "ECONNREFUSED",
    });

    expect(safeErrorSummary(driver)).toEqual({ name: "MongoNetworkError", code: "ECONNREFUSED" });
    expect(safeErrorSummary(Object.assign(new Error(QUOTING), { code: 11000 }))).toEqual({
      name: "Error",
      code: "11000",
    });
    // A code that is not a plain word could be anything, an address included.
    expect(
      safeErrorSummary(Object.assign(new Error("refused"), { code: "marta@example.com" })),
    ).toEqual({ name: "Error" });
    expect(safeErrorSummary(`thrown as text: ${QUOTING}`)).toEqual({ name: "string" });
  });
});

describe("what a failure answers", () => {
  it.each([
    ["a body that is not JSON", '{"email": "marta@example.com", "no', {}, 400],
    ["an empty JSON body", "", {}, 400],
    ["a body shorter than its content-length", "{}", { "content-length": "20" }, 400],
    ["a content type nobody reads", "<marta/>", { "content-type": "application/xml" }, 415],
    ["a body over the route's limit", { ...BODY, note: "undo log ".repeat(600) }, {}, 413],
  ])("is a fixed body for %s, quoting none of it", async (_refusal, payload, headers, status) => {
    const { lines, build } = logged();
    const app = await build();

    const response = await app.inject({
      method: "POST",
      url: "/access-request/start",
      headers: { "x-client-ip": "203.0.113.2", "content-type": "application/json", ...headers },
      payload: typeof payload === "string" ? payload : JSON.stringify(payload),
    });

    expect(response.statusCode).toBe(status);
    expect(response.body).toBe('{"error":"invalid_request"}');
    const log = lines.join("");
    expect(lines.length).toBeGreaterThan(0);
    expect(log).not.toContain("request.failed");
    expect(log).not.toMatch(TYPED);
    expect(log).not.toMatch(REFUSED_BODY);
    expect(log).not.toMatch(/"err"|"stack"/);
  });

  it("is a fixed 400 for a body a route's own schema refuses", async () => {
    const { lines, build } = logged();
    const app = await build();
    app.post(
      "/schema",
      { schema: { body: { type: "object", required: ["email"] } } },
      async () => ({ reached: true }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/schema",
      payload: { note: "undo" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toBe('{"error":"invalid_request"}');
    const log = lines.join("");
    expect(lines.length).toBeGreaterThan(0);
    expect(log).not.toMatch(REFUSED_BODY);
    expect(log).not.toMatch(/"err"|"stack"/);
  });

  it.each([400, 401, 403, 404, 413, 415, 422, 429, 499])(
    "is a 500 for a thrown error that carries status %i of its own, logged by name and code",
    async (statusCode) => {
      const { lines, build } = logged();
      const thrown = Object.assign(new Error(QUOTING), {
        name: "ProviderError",
        code: "rate_limit_exceeded",
        statusCode,
      });
      const app = await build({ mailer: failingCodeMail(thrown) });

      const response = await post(app, "start", BODY, "203.0.113.7");

      expect(response.statusCode).toBe(500);
      expect(response.body).toBe('{"error":"internal_error"}');
      expect(response.headers["retry-after"]).toBeUndefined();
      const failures = lines
        .map((line) => JSON.parse(line) as { msg?: string; name?: string; code?: string })
        .filter((line) => line.msg === "request.failed");
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ name: "ProviderError", code: "rate_limit_exceeded" });
      const log = lines.join("");
      expect(log).not.toMatch(TYPED);
      expect(log).not.toMatch(/failed on|"err"|"stack"/);
    },
  );

  it.each([
    { code: "FST_ERR_CTP_BODY_TOO_LARGE", statusCode: 413 },
    { code: "FST_ERR_CTP_INVALID_MEDIA_TYPE", statusCode: 415 },
    { code: "FST_ERR_VALIDATION", statusCode: 400 },
    { code: "FST_ERR_VALIDATION", statusCode: 400, validation: "marta@example.com" },
  ])("is a 500 for a thrown error that borrows a framework code: %o", async (borrowed) => {
    const { build } = logged();
    const app = await build({
      mailer: failingCodeMail(Object.assign(new Error(QUOTING), borrowed)),
    });

    const response = await post(app, "start", BODY, "203.0.113.7");

    expect(response.statusCode).toBe(500);
    expect(response.body).toBe('{"error":"internal_error"}');
  });

  it("is a fixed body for an error nobody mapped, with none of its message", async () => {
    const { build } = logged();
    const app = await build();
    const { token } = (await post(app, "start", BODY, "203.0.113.3")).json<{ token: string }>();
    const throwing = await build({ mailer: failingDelivery(new Error(QUOTING)) });

    const response = await post(throwing, "verify", { token, code: CODE }, "203.0.113.3");

    expect(response.statusCode).toBe(500);
    expect(response.body).toBe('{"error":"internal_error"}');
  });

  it("is a fixed body for a route nobody registered, without the URL", async () => {
    const { build } = logged();
    const app = await build();

    const response = await app.inject({ method: "GET", url: "/nowhere/marta?note=undo" });

    expect(response.statusCode).toBe(404);
    expect(response.body).toBe('{"error":"not_found"}');
  });

  it("is a fixed body for the limiter's 429, which keeps retry-after and logs no message", async () => {
    const { lines, build } = logged();
    const app = await build();

    for (let i = 0; i < 5; i += 1) await post(app, "start", BODY, "203.0.113.9");
    const response = await post(app, "start", BODY, "203.0.113.9");

    expect(response.statusCode).toBe(429);
    expect(response.body).toBe('{"error":"rate_limited"}');
    expect(String(response.headers["retry-after"])).toBe("3600");
    const limited = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.msg === "request.rate_limited");
    expect(limited).toHaveLength(1);
    expect(limited[0]).toMatchObject({ name: "RateLimited" });
    expect(Object.keys(limited[0] ?? {}).sort()).toEqual(
      ["hostname", "level", "msg", "name", "pid", "time"].sort(),
    );
    const log = lines.join("");
    expect(log).not.toMatch(TYPED);
    expect(log).not.toMatch(/Rate limit exceeded|retry in|"err"|"stack"/);
  });
});

describe("the log, across the whole flow", () => {
  it("holds no address, no note, no token and no token digest in any line", async () => {
    const { lines, build } = logged();
    const statuses: number[] = [];
    const run = async (response: Promise<{ statusCode: number }>) => {
      statuses.push((await response).statusCode);
    };

    // Start, verify, the same token again, and a wrong code.
    const app = await build();
    const started = await post(app, "start", BODY, "203.0.113.1");
    const token = started.json<{ token: string }>().token;
    statuses.push(started.statusCode);
    await run(post(app, "verify", { token, code: CODE }, "203.0.113.1"));
    await run(post(app, "verify", { token, code: CODE }, "203.0.113.1"));
    await run(post(app, "verify", { token, code: "000000" }, "203.0.113.1"));

    // Refused bodies: each field wrong in turn, then a body that is not JSON at all.
    await run(post(app, "start", { ...BODY, email: "marta-is-not-an-address" }, "203.0.113.2"));
    await run(post(app, "start", { ...BODY, note: "undo log\u0000" }, "203.0.113.2"));
    await run(post(app, "start", '{"email": "marta@example.com", "note": "undo l', "203.0.113.2"));
    await run(post(app, "verify", { token, code: "marta@example.com" }, "203.0.113.2"));

    // A failing mail: one the service maps, and one thrown by something it does not know.
    const refusing = await build({ mailer: failingDelivery(new MailDeliveryFailed(QUOTING)) });
    await run(post(refusing, "verify", { token, code: CODE }, "203.0.113.3"));
    const throwing = await build({ mailer: failingDelivery(new Error(QUOTING)) });
    await run(post(throwing, "verify", { token, code: CODE }, "203.0.113.3"));

    // A store that fails on the claim, quoting the row's key: the mail goes anyway.
    const storeError = Object.assign(new Error(`E11000 ${QUOTING} ${signer.digest(token)}`), {
      code: 11000,
    });
    const storeless = await build({ repository: unavailableRepository(storeError) });
    await run(post(storeless, "verify", { token, code: CODE }, "203.0.113.4"));

    expect(statuses).toEqual([200, 200, 200, 400, 400, 400, 400, 400, 503, 500, 200]);

    const log = lines.join("");
    // The log was read: request lines are in it, and so is each failure, by its fixed code.
    expect(lines.length).toBeGreaterThan(20);
    expect(log).toContain('"url":"/access-request/start"');
    expect(log).toContain('"msg":"access_request.claim_failed"');
    expect(log).toContain('"msg":"request.failed"');
    expect(log).toContain('"code":"11000"');

    expect(log).not.toMatch(TYPED);
    expect(log).not.toContain(signer.digest(token));
    expect(log).not.toContain(token);
    expect(log).not.toContain("E11000");
    expect(log).not.toContain("failed on");
    expect(log).not.toMatch(/203\.0\.113\.|127\.0\.0\.1/);
  });

  it("names the route, never the URL, on both routes and on a 404", async () => {
    const { lines, build } = logged();
    const app = await build();
    const query = "?email=marta@example.com&note=undo";
    const inject = (method: "GET" | "POST", url: string, payload?: object) =>
      app.inject({ method, url, headers: { "x-client-ip": "203.0.113.6" }, payload });

    const statuses = [
      (await inject("POST", `/access-request/start${query}`, BODY)).statusCode,
      (await inject("POST", `/access-request/verify${query}`, { token: "x.y", code: CODE }))
        .statusCode,
      (await inject("GET", `/nowhere/marta@example.com${query}`)).statusCode,
    ];

    expect(statuses).toEqual([200, 400, 404]);
    const requested = lines
      .map((line) => JSON.parse(line) as { req?: unknown })
      .flatMap((line) => (line.req === undefined ? [] : [line.req]));
    expect(requested).toEqual([
      { method: "POST", url: "/access-request/start" },
      { method: "POST", url: "/access-request/verify" },
      { method: "GET", url: "unmatched" },
    ]);
    const log = lines.join("");
    expect(log).not.toMatch(TYPED);
    expect(log).not.toMatch(/\?|nowhere|not found/);
  });

  it("logs a failed release by its code alone", async () => {
    const { lines, build } = logged();
    const app = await build({
      mailer: failingDelivery(new MailDeliveryFailed(QUOTING)),
      repository: {
        claimVerification: async () => ({ claimed: true, createdRow: true }),
        releaseVerification: () => Promise.reject(new Error(QUOTING)),
        list: () => Promise.resolve([]),
      },
    });

    const started = await post(app, "start", BODY, "203.0.113.5");
    const { token } = started.json<{ token: string }>();
    const verified = await post(app, "verify", { token, code: CODE }, "203.0.113.5");

    expect(verified.statusCode).toBe(503);
    const log = lines.join("");
    expect(log).toContain('"msg":"access_request.release_failed"');
    expect(log).not.toMatch(TYPED);
  });
});
