import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  PHASE_ANALYZE,
  PHASE_DEVELOPMENT_SERVER,
  PHASE_EXPORT,
  PHASE_INFO,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
  PHASE_TEST,
} from "next/constants";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEV_SESSION_ALIASES, devSessionAliases } from "@/dev-session/aliases";
import { LOOPBACK_BIND_MARK } from "@/dev-session/bind";
import nextConfig from "@/next.config";

const WEB = join(import.meta.dirname, "..", "..");

const ON = {
  NODE_ENV: "development",
  DEV_AUTH_USER_ID: "user_dev_1",
  [LOOPBACK_BIND_MARK.name]: LOOPBACK_BIND_MARK.value,
} as const satisfies NodeJS.ProcessEnv;

const NOT_THE_DEV_SERVER = [
  PHASE_PRODUCTION_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_EXPORT,
  PHASE_ANALYZE,
  PHASE_INFO,
  PHASE_TEST,
];

describe("which phases the dev session can exist in", () => {
  it("aliases both Clerk entry points under next dev, started by dev", () => {
    expect(devSessionAliases(PHASE_DEVELOPMENT_SERVER, ON)).toEqual(DEV_SESSION_ALIASES);
  });

  it.each(NOT_THE_DEV_SERVER)(
    "aliases nothing in %s, even given everything the dev server would be given",
    (phase) => {
      expect(devSessionAliases(phase, ON)).toEqual({});
    },
  );

  it.each([
    ["the id is unset", { NODE_ENV: "development", [LOOPBACK_BIND_MARK.name]: "loopback" }],
    ["the id is blank", { ...ON, DEV_AUTH_USER_ID: "" }],
    ["NODE_ENV is production", { ...ON, NODE_ENV: "production" }],
    ["NODE_ENV is test", { ...ON, NODE_ENV: "test" }],
  ] as const)("aliases nothing under next dev when %s", (_case, env) => {
    expect(devSessionAliases(PHASE_DEVELOPMENT_SERVER, env)).toEqual({});
  });

  it.each(Object.values(DEV_SESSION_ALIASES))("points at a stand-in that exists: %s", (target) => {
    expect(existsSync(join(WEB, target))).toBe(true);
  });
});

describe("a dev server that dev did not start", () => {
  it.each([
    ["no mark", { NODE_ENV: "development", DEV_AUTH_USER_ID: "user_dev_1" }],
    ["a blank mark, as dev:lan sets it", { ...ON, [LOOPBACK_BIND_MARK.name]: "" }],
    ["a mark naming another bind", { ...ON, [LOOPBACK_BIND_MARK.name]: "lan" }],
  ] as const)("refuses the dev session with %s, and never quotes the id", (_case, env) => {
    expect(() => devSessionAliases(PHASE_DEVELOPMENT_SERVER, env)).toThrow(/not started by `dev`/);
    expect(() => devSessionAliases(PHASE_DEVELOPMENT_SERVER, env)).not.toThrow(/user_dev_1/);
  });
});

describe("next.config.ts", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function withDevSessionEnvironment() {
    for (const [name, value] of Object.entries(ON)) vi.stubEnv(name, value);
    return vi.spyOn(console, "warn").mockImplementation(() => {});
  }

  const devSessionAliasesIn = (phase: string) =>
    Object.keys(nextConfig(phase).turbopack?.resolveAlias ?? {}).filter((specifier) =>
      specifier.startsWith("@clerk/"),
    );

  it("stands in for Clerk under next dev, and says so", () => {
    const warned = withDevSessionEnvironment();

    expect(devSessionAliasesIn(PHASE_DEVELOPMENT_SERVER).toSorted()).toEqual(
      Object.keys(DEV_SESSION_ALIASES).toSorted(),
    );
    expect(warned).toHaveBeenCalledTimes(1);
  });

  it.each(NOT_THE_DEV_SERVER)("keeps the real Clerk in %s, in that same environment", (phase) => {
    const warned = withDevSessionEnvironment();

    expect(devSessionAliasesIn(phase)).toEqual([]);
    expect(warned).not.toHaveBeenCalled();
  });
});
