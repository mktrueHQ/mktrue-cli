import { describe, expect, it } from "vitest";

import { admittedUserIds, parseConfig } from "@api/app/config";
import { selectTokenVerifier } from "@api/app/server";
import { ClerkTokenVerifier } from "@api/contexts/auth/infrastructure/clerk-token-verifier";
import { DevSessionTokenVerifier } from "@api/contexts/auth/infrastructure/dev-session-token-verifier";
import { NullTokenVerifier } from "@api/contexts/auth/infrastructure/null-token-verifier";

const OWNER = "user_owner_1";
const HER = "user_other_2";
const CLERK = { CLERK_SECRET_KEY: "sk_test_template", CLERK_ISSUER: "https://clerk.example.test" };
const PRODUCTION = {
  NODE_ENV: "production",
  MONGO_URI: "mongodb://localhost:27017/?replicaSet=rs0",
  MONGO_DB_NAME: "app",
  OWNER_USER_ID: OWNER,
  ...CLERK,
};

describe("a fresh clone, with nothing configured", () => {
  it("parses, rather than refusing to start", () => {
    const config = parseConfig({});

    expect(config.nodeEnv).toBe("development");
    expect(config.mongo.uri).toBeUndefined();
    expect(config.auth.ownerUserId).toBeUndefined();
    expect(config.devSession).toBeUndefined();
  });

  it("reads every blank variable as unset", () => {
    const config = parseConfig({
      CLERK_SECRET_KEY: "",
      CLERK_ISSUER: "",
      OWNER_USER_ID: "",
      ALLOWED_USER_IDS: "",
      MONGO_URI: "",
    });

    expect(config.clerk).toEqual({ secretKey: undefined, issuer: undefined });
    expect(config.auth.ownerUserId).toBeUndefined();
    expect([...config.auth.allowedUserIds]).toEqual([]);
    expect(config.mongo.uri).toBeUndefined();
  });

  it("selects the verifier that refuses", async () => {
    const verifier = selectTokenVerifier(parseConfig({}).clerk);

    expect(verifier).toBeInstanceOf(NullTokenVerifier);
    await expect(verifier.verify("anything")).rejects.toThrow("not configured");
  });
});

describe("selectTokenVerifier", () => {
  it.each([
    ["nothing is set", {}],
    ["only the secret key is set", { secretKey: CLERK.CLERK_SECRET_KEY }],
    ["only the issuer is set", { issuer: CLERK.CLERK_ISSUER }],
  ])("falls back to the null verifier when %s", (_case, clerk) => {
    expect(selectTokenVerifier(clerk)).toBeInstanceOf(NullTokenVerifier);
  });

  it("builds real verification from a full pair", () => {
    expect(
      selectTokenVerifier({ secretKey: CLERK.CLERK_SECRET_KEY, issuer: CLERK.CLERK_ISSUER }),
    ).toBeInstanceOf(ClerkTokenVerifier);
  });

  it("prefers a dev session that parseConfig allowed", () => {
    expect(
      selectTokenVerifier(
        { secretKey: CLERK.CLERK_SECRET_KEY, issuer: CLERK.CLERK_ISSUER },
        { userId: OWNER },
      ),
    ).toBeInstanceOf(DevSessionTokenVerifier);
  });

  it("refuses to construct the real verifier from half a pair", () => {
    expect(() => new ClerkTokenVerifier({ secretKey: "", issuer: CLERK.CLERK_ISSUER })).toThrow();
    expect(
      () => new ClerkTokenVerifier({ secretKey: CLERK.CLERK_SECRET_KEY, issuer: "" }),
    ).toThrow();
  });
});

describe("production", () => {
  it("boots with everything it needs", () => {
    expect(parseConfig(PRODUCTION).nodeEnv).toBe("production");
  });

  it.each(["MONGO_URI", "MONGO_DB_NAME", "CLERK_SECRET_KEY", "CLERK_ISSUER", "OWNER_USER_ID"])(
    "refuses to boot without %s",
    (name) => {
      expect(() => parseConfig({ ...PRODUCTION, [name]: "" })).toThrow(name);
    },
  );

  it("names every missing variable in one refusal", () => {
    expect(() => parseConfig({ NODE_ENV: "production" })).toThrow(
      "MONGO_URI, MONGO_DB_NAME, CLERK_SECRET_KEY, CLERK_ISSUER, OWNER_USER_ID",
    );
  });
});

describe("the whitelist", () => {
  it("admits the owner alone when ALLOWED_USER_IDS is blank", () => {
    expect([...parseConfig({ OWNER_USER_ID: OWNER }).auth.allowedUserIds]).toEqual([OWNER]);
  });

  it("admits the owner whatever the list says", () => {
    const admitted = parseConfig({ OWNER_USER_ID: OWNER, ALLOWED_USER_IDS: HER }).auth
      .allowedUserIds;

    expect([...admitted].toSorted()).toEqual([OWNER, HER].toSorted());
  });

  it("accepts commas, spaces and both", () => {
    const admitted = parseConfig({ ALLOWED_USER_IDS: `${HER}, user_third_3 user_fourth_4` }).auth
      .allowedUserIds;

    expect([...admitted].toSorted()).toEqual([HER, "user_third_3", "user_fourth_4"].toSorted());
  });

  it("refuses a pasted email, and does not quote it", () => {
    let message = "";
    try {
      parseConfig({ ALLOWED_USER_IDS: "someone@example.com" });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("principal ids");
    expect(message).not.toContain("someone@example.com");
  });

  it("hands back a fresh set on every path", () => {
    const configured = new Set([HER]);

    expect(admittedUserIds(undefined, configured)).not.toBe(configured);
    expect([...admittedUserIds(undefined, configured)]).toEqual([HER]);
    expect([...admittedUserIds(undefined, [])]).toEqual([]);
  });
});

describe("the dev session", () => {
  const LOCAL = { NODE_ENV: "development", HOST: "localhost", OWNER_USER_ID: OWNER };

  it("exists on a loopback host, in development, for an admitted principal", () => {
    expect(parseConfig({ ...LOCAL, DEV_AUTH_USER_ID: OWNER }).devSession).toEqual({
      userId: OWNER,
    });
  });

  it.each([
    ["under NODE_ENV=production", { ...LOCAL, ...PRODUCTION, HOST: "localhost" }],
    ["under NODE_ENV=test", { ...LOCAL, NODE_ENV: "test" }],
    ["on a host every interface can reach", { ...LOCAL, HOST: "0.0.0.0" }],
    ["for a principal the whitelist does not admit", { ...LOCAL, DEV_AUTH_USER_ID: HER }],
    ["with no owner set", { NODE_ENV: "development", HOST: "localhost" }],
  ])("refuses to boot %s", (_case, env) => {
    expect(() => parseConfig({ DEV_AUTH_USER_ID: OWNER, ...env } as NodeJS.ProcessEnv)).toThrow(
      "DEV_AUTH_USER_ID",
    );
  });
});

describe("the default time zone", () => {
  it("defaults when blank", () => {
    expect(parseConfig({ DEFAULT_TIMEZONE: "" }).defaultTimeZone).toBe("Europe/Madrid");
  });

  it("refuses a zone this runtime does not know", () => {
    expect(() => parseConfig({ DEFAULT_TIMEZONE: "Europe/Atlantis" })).toThrow("IANA");
  });
});
