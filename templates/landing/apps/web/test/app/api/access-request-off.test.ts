import { NextRequest } from "next/server";

import { afterEach, describe, expect, it, vi } from "vitest";

// A blank `API_BASE_URL` is the request flow switched off: the routes refuse before reading the
// body or calling `fetch`, and the page is a 404. Setting the variable brings both back.
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
  setRequestLocale: vi.fn(),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound,
}));

const ROUTES = ["start", "verify"] as const;

/** A request every other check would let through: valid JSON, under the cap. */
function post(path: string): NextRequest {
  const payload = JSON.stringify({ email: "marta@example.com" });
  return new NextRequest(`http://web/api/access-request/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(payload.length),
      "cf-connecting-ip": "203.0.113.7",
    },
    body: payload,
  });
}

async function withApi(apiBaseUrl: string) {
  vi.resetModules(); // `lib/config` reads `process.env` once, at import.
  vi.stubEnv("API_BASE_URL", apiBaseUrl);
  const fetchSpy = vi.fn<typeof fetch>(async () => Response.json({ token: "signed-token" }));
  vi.stubGlobal("fetch", fetchSpy);
  return {
    fetchSpy,
    route: (path: (typeof ROUTES)[number]) =>
      path === "start"
        ? import("@/app/api/access-request/start/route")
        : import("@/app/api/access-request/verify/route"),
    page: () => import("@/app/[locale]/request-access/page"),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  notFound.mockClear();
});

describe("with API_BASE_URL blank", () => {
  it.each(ROUTES)("/api/access-request/%s answers 503 without calling fetch", async (path) => {
    const { fetchSpy, route } = await withApi("");
    const request = post(path);

    const response = await (await route(path)).POST(request);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "mail_unavailable" });
    expect(fetchSpy).not.toHaveBeenCalled();
    // Refused before the body is read, so nothing a caller sent is even buffered.
    expect(request.bodyUsed).toBe(false);
  });

  it("refuses even a malformed or oversized body with 503, not 400 or 413", async () => {
    const { fetchSpy, route } = await withApi("   ");
    const { POST } = await route("start");

    const malformed = new NextRequest("http://web/api/access-request/start", {
      method: "POST",
      body: "{not json",
    });
    const oversized = new NextRequest("http://web/api/access-request/start", {
      method: "POST",
      headers: { "content-length": "999999" },
      body: "{}",
    });

    expect((await POST(malformed)).status).toBe(503);
    expect((await POST(oversized)).status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("/[locale]/request-access is a 404", async () => {
    const { page } = await withApi("");
    const { default: RequestAccessPage } = await page();

    await expect(RequestAccessPage({ params: Promise.resolve({ locale: "en" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(notFound).toHaveBeenCalledOnce();
  });
});

describe("with API_BASE_URL set", () => {
  it.each(ROUTES)("/api/access-request/%s forwards to the API as before", async (path) => {
    const { fetchSpy, route } = await withApi("http://api:4201");

    const response = await (await route(path)).POST(post(path));

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(`http://api:4201/access-request/${path}`);
  });

  it("/[locale]/request-access renders", async () => {
    const { page } = await withApi("http://api:4201");
    const { default: RequestAccessPage } = await page();

    const element = await RequestAccessPage({ params: Promise.resolve({ locale: "en" }) });

    expect(element).toBeTruthy();
    expect(notFound).not.toHaveBeenCalled();
  });
});
