import { exampleItemDtoSchema } from "@__MKTRUE_NAME__/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

const ownerToken = vi.hoisted(() => vi.fn(async () => "token_from_the_session"));
vi.mock("@/lib/owner-token", () => ({ ownerToken }));

async function withApiBase(value: string) {
  vi.resetModules(); // `lib/config` reads the environment once, at import.
  vi.stubEnv("API_BASE_URL", value);
  const fetchSpy = vi.fn<typeof fetch>(async () => Response.json([]));
  vi.stubGlobal("fetch", fetchSpy);
  vi.spyOn(console, "error").mockImplementation(() => {});
  return { fetchSpy, api: await import("@/lib/api") };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  ownerToken.mockClear();
});

describe("with API_BASE_URL blank", () => {
  it.each(["", "   "])(
    "a read is unavailable: nothing is fetched, no token is minted (%j)",
    async (blank) => {
      const { fetchSpy, api } = await withApiBase(blank);

      const result = await api.apiGet({
        path: "/example-items",
        expect: exampleItemDtoSchema.array(),
      });

      expect(result).toEqual({ status: "unavailable", reason: "api" });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(ownerToken).not.toHaveBeenCalled();
    },
  );

  it("a write is unavailable too, and its body goes nowhere", async () => {
    const { fetchSpy, api } = await withApiBase("");

    const result = await api.apiSend({
      method: "POST",
      path: "/example-items",
      body: { title: "One" },
      expect: exampleItemDtoSchema,
    });

    expect(result).toEqual({ status: "unavailable", reason: "api" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("with API_BASE_URL set", () => {
  it("reaches the API it names", async () => {
    const { fetchSpy, api } = await withApiBase("http://api.test");

    await api.apiGet({ path: "/example-items", expect: exampleItemDtoSchema.array() });

    expect(fetchSpy.mock.calls[0]?.[0]).toBe("http://api.test/example-items");
  });
});
