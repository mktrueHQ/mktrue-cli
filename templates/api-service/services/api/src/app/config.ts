import { resolve } from "node:path";

import { z } from "zod";

import { isSupportedTimeZone } from "../contexts/shared/domain/civil-date";

export interface Config {
  readonly port: number;
  readonly host: string;
  readonly version: string;
  readonly commitSha?: string;
  readonly nodeEnv: string;
  readonly defaultTimeZone: string;
  readonly mongo: MongoConfig;
  readonly auth: AuthConfig;
  readonly clerk: ClerkConfig;
  readonly devSession?: DevSessionConfig;
}

export interface DevSessionConfig {
  readonly userId: string;
}

export interface MongoConfig {
  readonly uri?: string;
  readonly dbName?: string;
}

export interface AuthConfig {
  readonly ownerUserId?: string;
  readonly allowedUserIds: ReadonlySet<string>;
}

export interface ClerkConfig {
  readonly secretKey?: string;
  readonly issuer?: string;
}

const REQUIRED_IN_PRODUCTION = [
  "MONGO_URI",
  "MONGO_DB_NAME",
  "CLERK_SECRET_KEY",
  "CLERK_ISSUER",
  "OWNER_USER_ID",
] as const;

const blankToUndefined = (value: unknown): unknown => (value === "" ? undefined : value);
const optionalString = () => z.preprocess(blankToUndefined, z.string().min(1).optional());

const PRINCIPAL_ID = /^user_[A-Za-z0-9_-]+$/;

const WHITELIST_SEPARATORS = /[\s,]+/;

const DEFAULT_PORT = __MKTRUE_API_PORT__;

const envSchema = z.object({
  PORT: z.preprocess(blankToUndefined, z.coerce.number().int().positive().default(DEFAULT_PORT)),
  HOST: z.preprocess(blankToUndefined, z.string().min(1).default("0.0.0.0")),
  API_VERSION: z.preprocess(blankToUndefined, z.string().min(1).default("0.1.0")),
  NODE_ENV: z.preprocess(blankToUndefined, z.string().min(1).default("development")),
  DEFAULT_TIMEZONE: z.preprocess(
    blankToUndefined,
    z
      .string()
      .min(1)
      .refine(isSupportedTimeZone, "is not an IANA time zone this runtime knows")
      .default("Europe/Madrid"),
  ),
  MONGO_URI: optionalString(),
  MONGO_DB_NAME: optionalString(),
  CLERK_SECRET_KEY: optionalString(),
  CLERK_ISSUER: optionalString(),
  OWNER_USER_ID: optionalString(),
  ALLOWED_USER_IDS: z.preprocess(
    blankToUndefined,
    z
      .string()
      .min(1)
      .transform((value) => value.split(WHITELIST_SEPARATORS).filter((id) => id.length > 0))
      .refine(
        (ids) => ids.every((id) => PRINCIPAL_ID.test(id)),
        "must be principal ids (user_…) separated by commas or spaces",
      )
      .optional(),
  ),
  DEV_AUTH_USER_ID: z.preprocess(
    blankToUndefined,
    z.string().regex(PRINCIPAL_ID, "must be a principal id (user_…)").optional(),
  ),
  GIT_SHA: optionalString(),
});

export function parseConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = envSchema.parse(env);
  const allowedUserIds = admittedUserIds(parsed.OWNER_USER_ID, parsed.ALLOWED_USER_IDS ?? []);

  if (parsed.DEV_AUTH_USER_ID) {
    assertDevSessionIsLocal(parsed, allowedUserIds);
  }

  if (parsed.NODE_ENV === "production") {
    assertRequiredForProduction(parsed);
  }

  return {
    port: parsed.PORT,
    host: parsed.HOST,
    version: parsed.API_VERSION,
    commitSha: parsed.GIT_SHA,
    nodeEnv: parsed.NODE_ENV,
    defaultTimeZone: parsed.DEFAULT_TIMEZONE,
    mongo: {
      uri: parsed.MONGO_URI,
      dbName: parsed.MONGO_DB_NAME,
    },
    auth: {
      ownerUserId: parsed.OWNER_USER_ID,
      allowedUserIds,
    },
    clerk: {
      secretKey: parsed.CLERK_SECRET_KEY,
      issuer: parsed.CLERK_ISSUER,
    },
    ...(parsed.DEV_AUTH_USER_ID ? { devSession: { userId: parsed.DEV_AUTH_USER_ID } } : {}),
  };
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1"]);

function assertDevSessionIsLocal(
  env: z.infer<typeof envSchema>,
  admitted: ReadonlySet<string>,
): void {
  if (env.NODE_ENV !== "development") {
    throw new Error(
      `DEV_AUTH_USER_ID is set under NODE_ENV=${env.NODE_ENV} — the dev session exists only in local development; unset it`,
    );
  }
  if (!LOOPBACK_HOSTS.has(env.HOST)) {
    throw new Error(
      "DEV_AUTH_USER_ID needs HOST to be a loopback address (localhost, 127.0.0.1 or ::1) — the dev session must not answer anything off this machine",
    );
  }
  if (!env.OWNER_USER_ID || !env.DEV_AUTH_USER_ID || !admitted.has(env.DEV_AUTH_USER_ID)) {
    throw new Error(
      "DEV_AUTH_USER_ID must be OWNER_USER_ID or on ALLOWED_USER_IDS, with OWNER_USER_ID set — the dev session never widens the whitelist",
    );
  }
}

export function admittedUserIds(
  ownerUserId: string | undefined,
  allowedUserIds: Iterable<string>,
): ReadonlySet<string> {
  // Always a new set: Object.freeze(config) does not freeze a Set inside it.
  return new Set([...allowedUserIds, ...(ownerUserId ? [ownerUserId] : [])]);
}

function assertRequiredForProduction(env: z.infer<typeof envSchema>): void {
  const missing = REQUIRED_IN_PRODUCTION.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`missing required env var(s) for production: ${missing.join(", ")}`);
  }
}

function loadRepoRootEnvFile(): void {
  try {
    process.loadEnvFile(resolve(process.cwd(), "../../.env"));
  } catch {
    // No .env is the fresh-clone state, and every variable has a fallback.
  }
}

loadRepoRootEnvFile();

export const config: Config = Object.freeze(parseConfig(process.env));
