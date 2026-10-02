import {
  CODE_VALIDITY_MS,
  DEFAULT_DAILY_SEND_LIMIT,
  MAILS_PER_REQUEST,
} from "../contexts/access-request/application/start-access-request";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `verificationMemory`'s sizing proof below assumes a token's life is short against a UTC day. If
 * that stops being true the memory is undersized, a still-live token is evicted, and it delivers
 * again — silently, and only visible in the mail volume. So it fails here, at import, rather than
 * there.
 */
if (2 * CODE_VALIDITY_MS >= DAY_MS) {
  throw new Error(
    "verificationMemory assumes 2 × CODE_VALIDITY_MS stays under one day; resize it with the token",
  );
}

/** Blank env vars are absent, not empty — so `FOO=` behaves the same as an unset `FOO`. */
function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

/**
 * A whole number above zero, or the boot fails.
 *
 * **`Number()` alone was not a check, and the failure was silent all the way down.**
 * `DAILY_SEND_LIMIT=forty` is `NaN`, which survives into `verificationMemory`, reaches mongod as
 * `$slice: -NaN` — accepted, storing an **empty array** — and turns the replay marker off without
 * a word: every replay claims again and mails again. A ceiling that cannot be parsed is not a
 * ceiling, so this refuses the boot the way a blank secret does. The value is not echoed back: env
 * contents do not belong in an error that will be logged.
 */
function positiveInteger(raw: string | undefined, fallback: number, name: string): number {
  const value = blankToUndefined(raw);
  if (value === undefined) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`refusing to boot: ${name} must be a whole number greater than zero`);
  }
  return parsed;
}

/**
 * The vars a production boot cannot proceed without.
 *
 * This is a **fail-fast gate, not a warning**: every one of these selects a refusing adapter or a
 * broken flow when blank, and a landing page that silently accepts access requests into nowhere is
 * worse than one that will not start.
 *
 * `MONGO_URI` is deliberately absent. Persistence is best-effort by design — the delivered email is
 * what __MKTRUE_OWNER__ acts on (see `verify-access-request.ts`) — so a missing database degrades to "the
 * mail still arrives" rather than failing the boot.
 */
const REQUIRED_IN_PRODUCTION = [
  "RESEND_API_KEY",
  "MAIL_FROM",
  "ACCESS_REQUEST_DESTINATION_EMAIL",
  "ACCESS_REQUEST_TOKEN_SECRET",
] as const;

export interface ApiConfig {
  readonly port: number;
  readonly host: string;
  readonly isProduction: boolean;
  /** Only ever true under vitest — used to silence the request log. */
  readonly isTest: boolean;
  readonly mongoUri: string | undefined;
  readonly mongoDbName: string;
  readonly resendApiKey: string | undefined;
  readonly mailFrom: string | undefined;
  readonly destinationEmail: string | undefined;
  readonly tokenSecret: string | undefined;
  /**
   * Instance-wide ceiling on mails sent per UTC day.
   *
   * Default 40, against a Resend free tier of 100/day that is shared across every domain on the
   * account. The gap is deliberate headroom for whatever else sends from it — a cap that consumes
   * the whole allowance protects nothing.
   */
  readonly dailySendLimit: number;
  /**
   * How many token digests a mailbox row remembers: `dailySendLimit + 1`.
   *
   * **Derived rather than fixed, and sized for the window rather than for the day.** The claim
   * marker only holds while the row can remember every token that might still be alive — evict a
   * live one and it can be claimed again, which is another mail. `SendBudget`'s key resets at
   * midnight UTC, so the live set is not one day's issuance: a caller can take day N's whole budget
   * in its final quarter-hour and day N+1's the instant it resets.
   *
   * **The operative window is `2 × CODE_VALIDITY_MS`, not one token's life.** The digests that can
   * push a given token out of the list come from tokens issued up to `CODE_VALIDITY_MS` before it
   * as well as during it, so the span to survive is twice the validity. At fifteen minutes that is
   * half an hour, which touches at most two UTC days, whose combined issuance is
   * `2 × floor(limit / 2)` and therefore at most the limit. One more than that cannot be cycled
   * past. At the default that is 41 hex strings on a row, about 2.6 KB.
   *
   * The import above asserts that window stays under a day, so raising the token's life fails at
   * boot instead of quietly undersizing this.
   *
   * It lives here rather than in the verify use case because that use case needs a memory size, not
   * a mail budget, and deriving one from the other at the call site put a paragraph of arithmetic
   * where a number belonged.
   */
  readonly verificationMemory: number;
  readonly commitSha: string;
  readonly version: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const isProduction = env.NODE_ENV === "production";
  const dailySendLimit = positiveInteger(
    env.DAILY_SEND_LIMIT,
    DEFAULT_DAILY_SEND_LIMIT,
    "DAILY_SEND_LIMIT",
  );

  // A start reserves `MAILS_PER_REQUEST`, so a smaller ceiling refuses every request forever. It
  // fails closed, which makes it a footgun rather than a hole — and a boot that refuses is louder
  // than a form that 503s at everyone in silence.
  if (dailySendLimit < MAILS_PER_REQUEST) {
    throw new Error(
      `refusing to boot: DAILY_SEND_LIMIT must be at least ${MAILS_PER_REQUEST}, one request's cost`,
    );
  }

  if (isProduction) {
    const missing = REQUIRED_IN_PRODUCTION.filter(
      (key) => blankToUndefined(env[key]) === undefined,
    );
    if (missing.length > 0) {
      throw new Error(
        `refusing to boot: these are required in production and are blank — ${missing.join(", ")}`,
      );
    }
  }

  return {
    port: Number(blankToUndefined(env.PORT) ?? 4201),
    host: blankToUndefined(env.HOST) ?? "0.0.0.0",
    isProduction,
    isTest: env.NODE_ENV === "test",
    mongoUri: blankToUndefined(env.MONGO_URI),
    mongoDbName: blankToUndefined(env.MONGO_DB_NAME) ?? "__MKTRUE_NAME__",
    resendApiKey: blankToUndefined(env.RESEND_API_KEY),
    mailFrom: blankToUndefined(env.MAIL_FROM),
    destinationEmail: blankToUndefined(env.ACCESS_REQUEST_DESTINATION_EMAIL),
    tokenSecret: blankToUndefined(env.ACCESS_REQUEST_TOKEN_SECRET),
    dailySendLimit,
    verificationMemory: dailySendLimit + 1,
    commitSha: blankToUndefined(env.GIT_SHA) ?? "unknown",
    version: blankToUndefined(env.API_VERSION) ?? "0.1.0",
  };
}
