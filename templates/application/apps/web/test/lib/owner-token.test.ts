import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clerk = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: clerk.auth }));

beforeEach(() => {
  vi.resetModules();
  clerk.auth.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function ownerTokenWith(env: Record<string, string>) {
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
    CLERK_SECRET_KEY: "",
    DEV_AUTH_USER_ID: "",
    ...env,
  })) {
    vi.stubEnv(name, value);
  }
  return (await import("@/lib/owner-token")).ownerToken;
}

const CLERK = { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x", CLERK_SECRET_KEY: "sk_test_x" };

describe("ownerToken", () => {
  it("is the session's own token, minted on the server", async () => {
    clerk.auth.mockResolvedValue({ getToken: async () => "token_from_the_session" });

    expect(await (await ownerTokenWith(CLERK))()).toBe("token_from_the_session");
  });

  it("is the session's token, never the dev-session id, when both are set", async () => {
    clerk.auth.mockResolvedValue({ getToken: async () => "token_from_the_session" });

    const ownerToken = await ownerTokenWith({ ...CLERK, DEV_AUTH_USER_ID: "user_dev" });

    expect(await ownerToken()).toBe("token_from_the_session");
  });

  it("is null, and asks nobody, when no sign-in is configured", async () => {
    expect(await (await ownerTokenWith({}))()).toBeNull();
    expect(clerk.auth).not.toHaveBeenCalled();
  });

  it("is null when half the Clerk pair is set", async () => {
    expect(await (await ownerTokenWith({ CLERK_SECRET_KEY: "sk_test_x" }))()).toBeNull();
  });

  it("is null when no middleware ran for the request", async () => {
    clerk.auth.mockRejectedValue(
      new Error("Clerk: auth() was called but Clerk can't detect usage of clerkMiddleware()."),
    );

    expect(await (await ownerTokenWith(CLERK))()).toBeNull();
  });

  it("lets any other failure of the session through, loudly", async () => {
    clerk.auth.mockRejectedValue(new Error("auth_signature_invalid"));

    await expect((await ownerTokenWith(CLERK))()).rejects.toThrow("auth_signature_invalid");
  });
});
