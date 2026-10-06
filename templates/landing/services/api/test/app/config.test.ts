import { describe, expect, it } from "vitest";

import { loadConfig } from "../../src/app/config";

const FILLED = {
  NODE_ENV: "production",
  RESEND_API_KEY: "re_test",
  // prettier-ignore
  MAIL_FROM: "__MKTRUE_TITLE__ <no-reply@example.com>",
  // prettier-ignore
  ACCESS_REQUEST_DESTINATION_EMAIL: "__MKTRUE_OWNER__@example.com",
  ACCESS_REQUEST_TOKEN_SECRET: "s".repeat(32),
} satisfies NodeJS.ProcessEnv;

const SECRET_TOO_SHORT =
  "refusing to boot: ACCESS_REQUEST_TOKEN_SECRET must be at least 32 characters when RESEND_API_KEY is set";

function refusal(boot: () => unknown): string {
  try {
    boot();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "booted";
}

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

  it("refuses a blank token secret, naming it", () => {
    for (const blank of ["", "   "]) {
      expect(() => loadConfig({ ...FILLED, ACCESS_REQUEST_TOKEN_SECRET: blank })).toThrow(
        /blank — ACCESS_REQUEST_TOKEN_SECRET$/,
      );
    }
  });

  it("refuses a token secret shorter than 32 characters, naming it and not its value", () => {
    const short = "k9".repeat(15) + "q";
    const boot = () => loadConfig({ ...FILLED, ACCESS_REQUEST_TOKEN_SECRET: short });

    expect(short).toHaveLength(31);
    expect(refusal(boot)).toBe(SECRET_TOO_SHORT);
    // Spaces around it are not part of it.
    expect(() => loadConfig({ ...FILLED, ACCESS_REQUEST_TOKEN_SECRET: ` ${short} ` })).toThrow(
      /ACCESS_REQUEST_TOKEN_SECRET/,
    );
    expect(() => loadConfig({ ...FILLED, ACCESS_REQUEST_TOKEN_SECRET: `${short}x` })).not.toThrow();
  });

  it("lets development run with nothing configured", () => {
    // Keys-later: a fresh clone must start, print codes to the console, and be walkable.
    expect(() => loadConfig({ NODE_ENV: "development" })).not.toThrow();
  });

  it("does not require Mongo, because persistence is best-effort", () => {
    expect(() => loadConfig({ ...FILLED, MONGO_URI: "" })).not.toThrow();
  });
});

describe("the token secret, wherever real mail is sent", () => {
  const SHORT = "k9".repeat(15) + "q";
  const env = (nodeEnv: string | undefined, rest: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
    nodeEnv === undefined ? rest : { ...rest, NODE_ENV: nodeEnv };

  describe.each([undefined, "development", "test", "staging", "prod", "Production"])(
    "under NODE_ENV=%s",
    (nodeEnv) => {
      it("refuses a blank or a short secret once a mail key is set, never echoing it", () => {
        for (const secret of [undefined, "", "   ", "x", SHORT, ` ${SHORT} `]) {
          const boot = () =>
            loadConfig(
              env(nodeEnv, { RESEND_API_KEY: "re_test", ACCESS_REQUEST_TOKEN_SECRET: secret }),
            );

          expect(refusal(boot), String(secret)).toBe(SECRET_TOO_SHORT);
        }
      });

      it("boots with a mail key and a secret of 32 characters", () => {
        const config = loadConfig(
          env(nodeEnv, { RESEND_API_KEY: "re_test", ACCESS_REQUEST_TOKEN_SECRET: `${SHORT}x` }),
        );

        expect(config.tokenSecret).toHaveLength(32);
      });

      it("holds the secret to nothing while no mail key is set", () => {
        for (const secret of [undefined, "  ", "short"]) {
          const boot = () => loadConfig(env(nodeEnv, { ACCESS_REQUEST_TOKEN_SECRET: secret }));

          expect(boot, String(secret)).not.toThrow();
        }
      });

      it("reads a blank mail key as no mail key", () => {
        for (const key of ["", "  "]) {
          const config = loadConfig(
            env(nodeEnv, { RESEND_API_KEY: key, ACCESS_REQUEST_TOKEN_SECRET: SHORT }),
          );

          expect(config.resendApiKey, JSON.stringify(key)).toBeUndefined();
          expect(config.tokenSecret, JSON.stringify(key)).toBe(SHORT);
        }
      });
    },
  );
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
