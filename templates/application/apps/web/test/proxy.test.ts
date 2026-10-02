import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const protectedPaths = vi.hoisted(() => [] as string[]);
vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware:
    (handler: (auth: unknown, request: NextRequest) => Promise<void>) =>
    async (request: NextRequest) => {
      const protect = async () => {
        protectedPaths.push(request.nextUrl.pathname);
      };
      await handler({ protect }, request);
    },
}));

const APP = join(import.meta.dirname, "..", "app");

function pageRoutes(directory = APP, route = ""): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return pageRoutes(path, `${route}/${entry}`);
    return entry === "page.tsx" ? [route === "" ? "/" : route] : [];
  });
}

function concrete(route: string): string {
  return (
    route
      .replace(/\/\([^)]+\)/g, "")
      .replace(/\/\[\[\.\.\.[^\]]+\]\]/g, "")
      .replace(/\[[^\]]+\]/g, "sample") || "/"
  );
}

const matcher = async () => new RegExp(`^${(await import("@/proxy")).config.matcher[0]}$`);

async function loadProxy() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_x");
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_x");
  return await import("@/proxy");
}

async function isProtected(path: string): Promise<boolean> {
  const proxy = await loadProxy();
  protectedPaths.length = 0;
  await (proxy.default as (request: NextRequest) => Promise<unknown>)(
    new NextRequest(`http://localhost${path}`),
  );
  return protectedPaths.includes(path);
}

describe("the pages anyone may reach", () => {
  it("are the sign-in flow and nothing else", async () => {
    expect([...(await import("@/proxy")).PUBLIC_PAGES]).toEqual(["/sign-in"]);
  });

  it.each(["/sign-in", "/sign-in/factor-one", "/sign-in/sso-callback"])(
    "lets %s through without a session",
    async (path) => {
      expect(await isProtected(path)).toBe(false);
    },
  );
});

describe("every other page", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("walks the pages the app actually has", () => {
    expect(pageRoutes()).toContain("/");
    expect(pageRoutes()).toContain("/no-access");
    expect(pageRoutes().length).toBeGreaterThan(2);
  });

  it.each(pageRoutes().filter((route) => !route.startsWith("/sign-in")))(
    "%s runs through the proxy and is protected",
    async (route) => {
      const path = concrete(route);

      expect((await matcher()).test(path)).toBe(true);
      expect(await isProtected(path)).toBe(true);
    },
  );

  it.each([
    "/a-page-added-tomorrow",
    "/sign-inx",
    "/settings/sign-in",
    "/items/a.b",
    "/items/v1.2",
    "/items/a.png.b",
    "/items/a.json",
  ])("protects %s, which nobody listed", async (path) => {
    expect((await matcher()).test(path)).toBe(true);
    expect(await isProtected(path)).toBe(true);
  });
});

describe("static files", () => {
  it.each(["/favicon.ico", "/logo.svg", "/fonts/body.woff2", "/robots.txt", "/_next/static/a.js"])(
    "leaves %s to Next",
    async (path) => {
      expect((await matcher()).test(path)).toBe(false);
    },
  );
});

describe("with no sign-in configured", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    vi.stubEnv("CLERK_SECRET_KEY", "");
    vi.stubEnv("DEV_AUTH_USER_ID", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes requests on to pages that refuse to render without it", async () => {
    const proxy = await import("@/proxy");
    protectedPaths.length = 0;

    await (proxy.default as (request: NextRequest) => unknown)(
      new NextRequest("http://localhost/"),
    );

    expect(protectedPaths).toEqual([]);
  });
});
