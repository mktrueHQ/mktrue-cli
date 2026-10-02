import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

import { LOOPBACK_BIND_MARK } from "./bind";

export const DEV_SESSION_ALIASES = {
  "@clerk/nextjs/server": "./dev-session/clerk-nextjs-server.ts",
  "@clerk/nextjs": "./dev-session/clerk-nextjs.ts",
} as const;

export const DEV_SESSION_WARNING =
  "dev session: @clerk/nextjs is stood in for, and every page is signed in as DEV_AUTH_USER_ID for anyone who can reach this server. `dev` listens on localhost only.";

export function devSessionAliases(
  phase: string,
  env: NodeJS.ProcessEnv,
): Readonly<Record<string, string>> {
  const requested =
    phase === PHASE_DEVELOPMENT_SERVER &&
    env.NODE_ENV === "development" &&
    (env.DEV_AUTH_USER_ID ?? "") !== "";
  if (!requested) return {};

  if (env[LOOPBACK_BIND_MARK.name] !== LOOPBACK_BIND_MARK.value) {
    throw new Error(
      "dev session: DEV_AUTH_USER_ID is set, but this dev server was not started by `dev`, the one script that listens on localhost only. Start it with `pnpm --filter @__MKTRUE_NAME__/web dev`, or blank DEV_AUTH_USER_ID.",
    );
  }
  return DEV_SESSION_ALIASES;
}
