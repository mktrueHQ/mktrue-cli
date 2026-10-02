import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEV_SESSION_ALIASES } from "@/dev-session/aliases";

const request = vi.hoisted(() => ({ host: "localhost:3000" as string | undefined }));
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => (name === "host" ? (request.host ?? null) : null),
  }),
}));

const WEB = join(import.meta.dirname, "..", "..");

function sourcesUnder(directory: string): string[] {
  return readdirSync(join(WEB, directory)).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(join(WEB, path)).isDirectory()) return sourcesUnder(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

const SHIPPED = [...sourcesUnder("app"), ...sourcesUnder("lib"), "proxy.ts"];

const CLERK_IMPORT = /import\s+([^;]*?)\s+from\s+["'](@clerk\/[^"']+)["']/g;

function clerkImports(): Map<string, Set<string>> {
  const named = new Map<string, Set<string>>();
  for (const file of SHIPPED) {
    for (const [, clause = "", specifier = ""] of readFileSync(join(WEB, file), "utf8").matchAll(
      CLERK_IMPORT,
    )) {
      if (clause.startsWith("type ")) continue;
      const names = named.get(specifier) ?? new Set<string>();
      for (const part of (/^\{([^}]*)\}$/.exec(clause.trim())?.[1] ?? clause).split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0] ?? "";
        if (name !== "" && !name.startsWith("type ")) names.add(name);
      }
      named.set(specifier, names);
    }
  }
  return named;
}

describe("the stand-ins answer every Clerk import the app makes", () => {
  const imports = clerkImports();

  it("finds the imports it is about", () => {
    expect(imports.get("@clerk/nextjs/server")).toContain("auth");
    expect(imports.get("@clerk/nextjs")).toContain("ClerkProvider");
  });

  it("aliases exactly the entry points the app imports", () => {
    expect([...imports.keys()].toSorted()).toEqual(Object.keys(DEV_SESSION_ALIASES).toSorted());
  });

  it.each(Object.entries(DEV_SESSION_ALIASES))(
    "stands in for every name the app imports from %s",
    async (specifier, target) => {
      vi.resetModules();
      vi.stubEnv("NODE_ENV", "development");
      const standIn = (await import(join(WEB, target))) as Record<string, unknown>;
      vi.unstubAllEnvs();

      expect(
        [...(imports.get(specifier) ?? [])].filter((name) => typeof standIn[name] !== "function"),
      ).toEqual([]);
    },
  );
});

describe("the stand-ins refuse to exist outside next dev", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(
    Object.values(DEV_SESSION_ALIASES).flatMap((target) =>
      ["production", "test"].map((nodeEnv) => [target, nodeEnv] as const),
    ),
  )("%s throws on load under NODE_ENV=%s, which next start runs under", async (target, env) => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", env);

    await expect(import(join(WEB, target))).rejects.toThrow(/stand-in loaded outside next dev/);
  });
});

describe("the @clerk/nextjs/server stand-in", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_AUTH_USER_ID", "user_dev_1");
    request.host = "localhost:3000";
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const load = () => import("@/dev-session/clerk-nextjs-server");

  it.each(["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "localhost"])(
    "answers a request addressed to %s as the dev user, whose token is their id",
    async (host) => {
      request.host = host;
      const session = await (await load()).auth();

      expect(session.userId).toBe("user_dev_1");
      await expect(session.getToken()).resolves.toBe("user_dev_1");
    },
  );

  it.each([
    ["another origin's name, as a rebinding page sends it", "evil.example:3000"],
    ["a name that starts with localhost", "localhost.evil.example:3000"],
    ["a loopback address inside another name", "127.0.0.1.nip.io:3000"],
    ["this machine's network address", "192.168.1.20:3000"],
    ["a bracket that never closes", "[::1:3000"],
    ["no Host at all", undefined],
  ])("refuses a request addressed to %s, and never quotes it", async (_case, host) => {
    request.host = host;
    const refusal = await (
      await load()
    )
      .auth()
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).toMatch(/not addressed to this machine/);
    expect((refusal as Error).message).not.toContain("evil.example");
  });

  it("throws rather than answer signed out when this process has no dev user", async () => {
    vi.stubEnv("DEV_AUTH_USER_ID", "");

    await expect((await load()).auth()).rejects.toThrow(/DEV_AUTH_USER_ID is not set/);
  });

  const addressedTo = (host: string | undefined) =>
    ({
      headers: { get: (name: string) => (name === "host" ? (host ?? null) : null) },
    }) as unknown as Request;

  it("lets the middleware pass a loopback request and refuse any other with 403", async () => {
    const { clerkMiddleware } = await load();

    expect(clerkMiddleware()(addressedTo("localhost:3000")).headers.get("x-middleware-next")).toBe(
      "1",
    );
    expect(clerkMiddleware()(addressedTo("evil.example:3000")).status).toBe(403);
  });
});

describe("the @clerk/nextjs stand-in", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "development");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(["ClerkProvider", "SignOutButton"] as const)(
    "renders %s's children and nothing else",
    async (name) => {
      const standIn = await import("@/dev-session/clerk-nextjs");

      expect(
        renderToStaticMarkup(createElement(standIn[name], null, createElement("span", null, "x"))),
      ).toBe("<span>x</span>");
    },
  );
});
