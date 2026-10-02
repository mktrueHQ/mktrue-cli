import { exampleItemDtoSchema } from "@__MKTRUE_NAME__/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiGet, apiSend } from "@/lib/api";
import { config } from "@/lib/config";

const token = vi.hoisted(() => ({ value: "token_from_the_session" as string | null }));
vi.mock("@/lib/owner-token", () => ({ ownerToken: async () => token.value }));

const ITEM = {
  id: "65f000000000000000000001",
  title: "One",
  status: "open",
  createdOn: "2026-09-21",
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  token.value = "token_from_the_session";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), { status }),
  );

const refusal = (code: string) => ({ error: { code, message: "refused" } });

const lastRequest = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) ?? [];
  return { url: String(url), init: init ?? {} };
};

describe("how the web tier identifies its caller to the API", () => {
  it.each(["/example-items", "/example-items?status=open", "/example-items?as=user_someone_else"])(
    "sends the session's token as a bearer, and no other header, on a read of %s",
    async (path) => {
      answer(200, [ITEM]);

      await apiGet({ path, expect: exampleItemDtoSchema.array() });

      expect(lastRequest().url).toBe(`${config.apiBaseUrl}${path}`);
      expect(lastRequest().init.headers).toEqual({
        authorization: "Bearer token_from_the_session",
      });
    },
  );

  it("adds only the content type on a write, and sends the body it was given", async () => {
    answer(200, {});

    await apiSend({
      method: "PATCH",
      path: "/profile",
      body: { locale: "en" },
      expect: { safeParse: (value: unknown) => ({ success: true as const, data: value }) },
    });

    expect(lastRequest().init.headers).toEqual({
      authorization: "Bearer token_from_the_session",
      "content-type": "application/json",
    });
    expect(lastRequest().init.body).toBe('{"locale":"en"}');
  });

  it("makes no call at all without a session token", async () => {
    token.value = null;

    const result = await apiGet({ path: "/example-items", expect: exampleItemDtoSchema.array() });

    expect(result).toEqual({ status: "unauthenticated" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("what the API said, never an exception", () => {
  const read = () => apiGet({ path: "/example-items", expect: exampleItemDtoSchema.array() });

  it("returns the parsed body on success", async () => {
    answer(200, [ITEM]);

    expect(await read()).toEqual({ status: "ok", data: [ITEM] });
  });

  it.each([
    ["unauthenticated", 401, { status: "unauthenticated" }],
    ["forbidden", 403, { status: "forbidden" }],
    ["not_found", 404, { status: "notFound" }],
    ["invalid_request", 400, { status: "invalid" }],
    ["conflict", 409, { status: "conflict" }],
    ["auth_unavailable", 503, { status: "unavailable", reason: "auth" }],
    ["storage_unavailable", 503, { status: "unavailable", reason: "storage" }],
    ["internal", 500, { status: "unavailable", reason: "api" }],
  ])("classifies %s", async (code, status, expected) => {
    answer(status, refusal(code));

    expect(await read()).toEqual(expected);
  });

  it.each([
    ["an unreachable API", () => fetchMock.mockRejectedValue(new TypeError("fetch failed"))],
    ["a refusal with no envelope", () => answer(502, "<html>bad gateway</html>")],
    ["a body the contract refuses", () => answer(200, [{ ...ITEM, status: "archived" }])],
    [
      "a body that is not JSON",
      () => fetchMock.mockResolvedValue(new Response("{not json", { status: 200 })),
    ],
  ])("answers %s as unavailable", async (_case, arrange) => {
    arrange();

    expect(await read()).toEqual({ status: "unavailable", reason: "api" });
  });
});
