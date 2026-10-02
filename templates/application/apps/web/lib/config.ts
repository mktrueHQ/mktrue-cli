import "server-only";

import { resolve } from "node:path";

import { authEnabled } from "./auth-enabled";

export interface WebConfig {
  readonly apiBaseUrl: string;
  readonly authEnabled: boolean;
}

export function parseConfig(env: NodeJS.ProcessEnv): WebConfig {
  return {
    apiBaseUrl: env.API_BASE_URL || "http://localhost:__MKTRUE_API_PORT__",
    authEnabled: authEnabled(env),
  };
}

try {
  process.loadEnvFile(resolve(process.cwd(), "../../.env"));
} catch {
  // No root .env: a fresh clone, or an image whose environment comes from the platform.
}

export const config: WebConfig = Object.freeze(parseConfig(process.env));
