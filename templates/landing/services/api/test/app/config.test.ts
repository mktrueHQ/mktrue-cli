import { describe, expect, it } from "vitest";

import { loadConfig } from "../../src/app/config";

const FILLED = {
  NODE_ENV: "production",
  RESEND_API_KEY: "re_test",
  // prettier-ignore
  MAIL_FROM: "__MKTRUE_TITLE__ <no-reply@example.com>",
  // prettier-ignore
  ACCESS_REQUEST_DESTINATION_EMAIL: "__MKTRUE_OWNER__@example.com",
  ACCESS_REQUEST_TOKEN_SECRET: "a-secret",
} satisfies NodeJS.ProcessEnv;

describe("the production boot gate", () => {
  it("boots when every required var is set", () => {
    expect(() => loadConfig(FILLED)).not.toThrow();
  });

  it("refuses to boot on a blank required var, naming it", () => {
    for (const key of Object.keys(FILLED).filter((k) => k !== "NODE_ENV")) {
      // Blank, not absent: `FOO=` is the shape a half-filled Dokploy env editor actually produces,
      // and it must fail exactly like a missing one.
      expect(() => loadConfig({ ...FILLED, [key]: "   " }), key).toThrow(new RegExp(key));
    }
  });

  it("lets development run with nothing configured", () => {
    // Keys-later: a fresh clone must start, print codes to the console, and be walkable.
    expect(() => loadConfig({ NODE_ENV: "development" })).not.toThrow();
  });

  it("does not require Mongo, because persistence is best-effort", () => {
    expect(() => loadConfig({ ...FILLED, MONGO_URI: "" })).not.toThrow();
  });
});

describe("the daily send limit", () => {
  it("defaults to 40, and remembers one more token than two days can issue", () => {
    const config = loadConfig(FILLED);

    expect(config.dailySendLimit).toBe(40);
    expect(config.verificationMemory).toBe(41);
  });

  it("refuses a value that is not a whole number above zero", () => {
    // `Number("forty")` is NaN, and NaN does not stop there: it reaches mongod as `$slice: -NaN`,
    // which is accepted and stores an empty array, so the replay marker is off and every replay
    // mails again. Silent, and only visible in the mail volume.
    for (const value of ["forty", "0", "-1", "2.5", "Infinity"]) {
      expect(() => loadConfig({ ...FILLED, DAILY_SEND_LIMIT: value }), value).toThrow(
        /DAILY_SEND_LIMIT/,
      );
    }
  });

  it("refuses a limit smaller than the cost of one request", () => {
    // A start reserves two, so a limit of 1 refuses every request forever — fail-closed, but a form
    // that 503s at everyone in silence is worse than a boot that will not start.
    expect(() => loadConfig({ ...FILLED, DAILY_SEND_LIMIT: "1" })).toThrow(/DAILY_SEND_LIMIT/);
    expect(loadConfig({ ...FILLED, DAILY_SEND_LIMIT: "2" }).dailySendLimit).toBe(2);
  });

  it("treats a blank one as absent rather than as zero", () => {
    expect(loadConfig({ ...FILLED, DAILY_SEND_LIMIT: "  " }).dailySendLimit).toBe(40);
  });

  it("keeps the memory one ahead of whatever the limit is set to", () => {
    expect(loadConfig({ ...FILLED, DAILY_SEND_LIMIT: "6" }).verificationMemory).toBe(7);
  });
});
