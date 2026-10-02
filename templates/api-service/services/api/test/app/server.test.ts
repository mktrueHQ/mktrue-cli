import { apiErrorSchema } from "@__MKTRUE_NAME__/contracts";
import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";

import { buildServer, PUBLIC_ENDPOINTS, type ServerOverrides } from "@api/app/server";

import { FakeTokenVerifier } from "../test-support/fake-token-verifier";
import {
  AUTHORIZED,
  OUTSIDER,
  OWNER,
  OWNER_TOKEN,
  serverAsOwner,
} from "../test-support/owner-server";
import { registeredRoutes } from "../test-support/registered-routes";

function serverWithUngatedProbe(overrides: ServerOverrides = {}): FastifyInstance {
  const server = buildServer(overrides);
  server.get("/probe", () => ({ reached: true }));
  return server;
}

const injectProbe = (server: FastifyInstance, authorization?: string) =>
  server.inject({
    method: "GET",
    url: "/probe",
    ...(authorization === undefined ? {} : { headers: { authorization } }),
  });

describe("the gate", () => {
  it("503s every gated route when nothing is configured", async () => {
    const server = serverWithUngatedProbe();

    const response = await injectProbe(server, `Bearer ${OWNER_TOKEN}`);

    expect(response.statusCode).toBe(503);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe("auth_unavailable");
    await server.close();
  });

  it("503s before consulting the verifier when OWNER_USER_ID is blank", async () => {
    const verifier = FakeTokenVerifier.verifyingAs(OWNER);
    const server = serverWithUngatedProbe({ tokenVerifier: verifier });

    const response = await injectProbe(server, `Bearer ${OWNER_TOKEN}`);

    expect(response.statusCode).toBe(503);
    expect(verifier.timesCalled).toBe(0);
    await server.close();
  });

  it("503s a bearer token when the owner is named and no provider is configured", async () => {
    const server = serverWithUngatedProbe({ ownerUserId: OWNER });

    const response = await injectProbe(server, `Bearer ${OWNER_TOKEN}`);

    expect(response.statusCode).toBe(503);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe("auth_unavailable");
    expect(response.body).not.toContain("reached");
    expect(response.body).not.toContain(OWNER);
    await server.close();
  });

  it("401s a request with no bearer token, and names the scheme it wants", async () => {
    const server = serverWithUngatedProbe({
      tokenVerifier: FakeTokenVerifier.verifyingAs(OWNER),
      ownerUserId: OWNER,
    });

    const response = await injectProbe(server);

    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toBe("Bearer");
    await server.close();
  });

  it("401s a token the verifier rejects", async () => {
    const server = serverWithUngatedProbe({
      tokenVerifier: FakeTokenVerifier.rejectingEveryToken(),
      ownerUserId: OWNER,
    });

    const response = await injectProbe(server, "Bearer not-a-real-token");

    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain("not-a-real-token");
    await server.close();
  });

  it("403s a verified principal who is not on the whitelist", async () => {
    const server = serverWithUngatedProbe({
      tokenVerifier: FakeTokenVerifier.verifyingAs(OUTSIDER),
      ownerUserId: OWNER,
    });

    const response = await injectProbe(server, `Bearer ${OWNER_TOKEN}`);

    expect(response.statusCode).toBe(403);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe("forbidden");
    expect(response.body).not.toContain(OUTSIDER);
    expect(response.body).not.toContain(OWNER);
    await server.close();
  });

  it("admits the owner, and marks the answer uncacheable", async () => {
    const server = serverWithUngatedProbe({
      tokenVerifier: FakeTokenVerifier.verifyingAs(OWNER),
      ownerUserId: OWNER,
    });

    const response = await injectProbe(server, `Bearer ${OWNER_TOKEN}`);

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    await server.close();
  });

  it("401s an unknown path rather than telling a stranger it does not exist", async () => {
    const server = serverAsOwner();

    const response = await server.inject({ method: "GET", url: "/no-such-route" });

    expect(response.statusCode).toBe(401);
    await server.close();
  });

  it("404s an unknown path in the contract's own shape once the caller is admitted", async () => {
    const server = serverAsOwner();

    const response = await server.inject({
      method: "GET",
      url: "/no-such-route?secret=1",
      headers: AUTHORIZED,
    });

    expect(response.statusCode).toBe(404);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe("not_found");
    expect(response.body).not.toContain("secret");
    await server.close();
  });
});

describe("the public endpoint list", () => {
  it("is exactly the two reads of /health", () => {
    expect([...PUBLIC_ENDPOINTS].toSorted()).toEqual(["GET /health", "HEAD /health"]);
  });

  it("mounts exactly the endpoints shipped so far", async () => {
    const server = buildServer();
    await server.ready();

    expect(
      registeredRoutes(server)
        .map((route) => `${route.method} ${route.path}`)
        .toSorted(),
    ).toEqual(
      [
        "GET /health",
        "HEAD /health",
        "GET /me",
        "HEAD /me",
        "GET /profile",
        "HEAD /profile",
        "PATCH /profile",
        "GET /example-items",
        "HEAD /example-items",
        "POST /example-items",
        "PATCH /example-items/:id",
        "GET /example-items/:id/notes",
        "HEAD /example-items/:id/notes",
        "POST /example-items/:id/notes",
        "GET /stats/example-items",
        "HEAD /stats/example-items",
      ].toSorted(),
    );
    await server.close();
  });

  it("does not open an unlisted method on a public path", async () => {
    const server = buildServer();
    server.post("/health", () => ({ ok: true }));

    const response = await server.inject({ method: "POST", url: "/health" });

    expect(response.statusCode).toBe(503);
    await server.close();
  });

  it("leaves /health answering on a server whose other routes refuse", async () => {
    const server = serverWithUngatedProbe();

    const [health, probe] = await Promise.all([
      server.inject({ method: "GET", url: "/health" }),
      injectProbe(server),
    ]);

    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: "ok", mongo: "disconnected" });
    expect(health.headers["cache-control"]).toBe("no-store");
    expect(probe.statusCode).toBe(503);
    await server.close();
  });

  it("is the only thing an anonymous caller can reach, across every registered route", async () => {
    const walk = async (server: FastifyInstance, refusal: number, authorization?: string) => {
      await server.ready();

      const routes = registeredRoutes(server);
      expect(routes.length).toBeGreaterThan(0);

      const answers = await Promise.all(
        routes.map(async (route) => {
          const response = await server.inject({
            method: route.method,
            url: route.path,
            ...(authorization === undefined ? {} : { headers: { authorization } }),
          });
          return `${route.method} ${route.path} → ${String(response.statusCode)}`;
        }),
      );

      expect(answers.toSorted()).toEqual(
        routes
          .map((route) => {
            const endpoint = `${route.method} ${route.path}`;
            return `${endpoint} → ${PUBLIC_ENDPOINTS.has(endpoint) ? 200 : refusal}`;
          })
          .toSorted(),
      );

      await server.close();
    };

    await walk(buildServer(), 503);
    await walk(
      buildServer({ tokenVerifier: FakeTokenVerifier.verifyingAs(OWNER), ownerUserId: OWNER }),
      401,
    );
    await walk(buildServer({ ownerUserId: OWNER }), 503, `Bearer ${OWNER_TOKEN}`);
  });
});
