import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";

import { requireUser } from "@api/middlewares/require-user";

import { FakeTokenVerifier } from "../test-support/fake-token-verifier";

const OWNER = "user_owner_1";
const TOKEN = "a-token";

function gatedServer(allowedUserIds: ReadonlySet<string>, ownerUserId?: string): FastifyInstance {
  const server = Fastify();
  server.decorateRequest("user", undefined);
  server.addHook(
    "onRequest",
    requireUser(
      { tokenVerifier: FakeTokenVerifier.verifyingAs(OWNER), ownerUserId, allowedUserIds },
      { publicEndpoints: new Set(["GET /open"]) },
    ),
  );
  server.get("/open", () => ({ open: true }));
  server.get("/closed", (request) => ({ userId: request.user?.userId }));
  return server;
}

const asOwner = { authorization: `Bearer ${TOKEN}` };

describe("requireUser", () => {
  it("admits a verified principal on the whitelist and attaches it", async () => {
    const server = gatedServer(new Set([OWNER]), OWNER);

    const response = await server.inject({ method: "GET", url: "/closed", headers: asOwner });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ userId: OWNER });
    await server.close();
  });

  it("admits nobody from an empty whitelist, the owner included", async () => {
    const server = gatedServer(new Set(), OWNER);

    const response = await server.inject({ method: "GET", url: "/closed", headers: asOwner });

    expect(response.statusCode).toBe(403);
    await server.close();
  });

  it.each([
    ["a prefix of the id", "user_owner"],
    ["the id in another case", "USER_OWNER_1"],
    ["the id with a trailing space", `${OWNER} `],
  ])("does not admit %s", async (_case, listed) => {
    const server = gatedServer(new Set([listed]), OWNER);

    const response = await server.inject({ method: "GET", url: "/closed", headers: asOwner });

    expect(response.statusCode).toBe(403);
    await server.close();
  });

  it("lets a public endpoint through with no principal attached", async () => {
    const server = gatedServer(new Set(), undefined);

    const response = await server.inject({ method: "GET", url: "/open" });

    expect(response.statusCode).toBe(200);
    await server.close();
  });

  it("does not treat a query string or another method as public", async () => {
    const server = gatedServer(new Set([OWNER]), OWNER);
    server.post("/open", () => ({ written: true }));

    const [withQuery, otherMethod] = await Promise.all([
      server.inject({ method: "GET", url: "/closed?public=1" }),
      server.inject({ method: "POST", url: "/open" }),
    ]);

    expect(withQuery.statusCode).toBe(401);
    expect(otherMethod.statusCode).toBe(401);
    await server.close();
  });
});
