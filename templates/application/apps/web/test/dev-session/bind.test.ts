import { describe, expect, it } from "vitest";

import {
  LOOPBACK_BIND_MARK,
  NETWORK_HOST,
  planDevServer,
  WEB_ENV_FILES,
  type DevServerPlan,
  type WebEnvFiles,
} from "@/dev-session/bind";

const LOOPBACK: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function bindOf(plan: DevServerPlan): string | undefined {
  if (plan.kind !== "start") return undefined;
  const at = plan.args.lastIndexOf("-H");
  return at === -1 ? undefined : plan.args[at + 1];
}

const marked = (plan: DevServerPlan) =>
  plan.kind === "start" && plan.env[LOOPBACK_BIND_MARK.name] === LOOPBACK_BIND_MARK.value;

describe("dev", () => {
  it("starts next dev bound to a loopback name, and marks it so", () => {
    const plan = planDevServer([], { DEV_AUTH_USER_ID: "user_dev_1" }, {});

    expect(plan.kind).toBe("start");
    expect(plan.kind === "start" ? plan.args[0] : undefined).toBe("dev");
    expect(LOOPBACK.has(bindOf(plan) ?? "")).toBe(true);
    expect(marked(plan)).toBe(true);
  });

  it.each([
    ["an -H of its own", ["-H", "0.0.0.0"]],
    ["a --hostname of its own", ["--hostname=0.0.0.0"]],
    ["a port of its own", ["-p", "5000"]],
    ["--lan with anything after it", ["--lan", "-H", "localhost"]],
  ])("refuses %s rather than pass it to next", (_case, argv) => {
    expect(planDevServer(argv, {}, {}).kind).toBe("refuse");
  });
});

describe("dev:lan", () => {
  const lan = (shell: NodeJS.Dict<string>, files: WebEnvFiles = {}) =>
    planDevServer(["--lan"], shell, files);

  it("listens on the network when no dev session is set anywhere, and carries no mark", () => {
    const plan = lan({}, { "../../.env": "OWNER_USER_ID=user_1\n" });

    expect(bindOf(plan)).toBe(NETWORK_HOST);
    expect(marked(plan)).toBe(false);
    expect(plan.kind === "start" ? plan.env[LOOPBACK_BIND_MARK.name] : "absent").toBe("");
  });

  it.each(WEB_ENV_FILES)("refuses when the dev session is set in %s", (file) => {
    expect(lan({}, { [file]: "DEV_AUTH_USER_ID=user_dev_1\n" }).kind).toBe("refuse");
  });

  it("refuses when the dev session is set in the shell", () => {
    expect(lan({ DEV_AUTH_USER_ID: "user_dev_1" }).kind).toBe("refuse");
  });

  it("does not consult NODE_ENV: a production NODE_ENV does not lift the refusal", () => {
    expect(lan({ NODE_ENV: "production", DEV_AUTH_USER_ID: "user_dev_1" }).kind).toBe("refuse");
  });

  it("reads blank as unset, as the session does", () => {
    expect(lan({}, { "../../.env": "DEV_AUTH_USER_ID=\n" }).kind).toBe("start");
  });

  it("lets the first definition decide, as both loaders do: a blank shell beats a file", () => {
    expect(lan({ DEV_AUTH_USER_ID: "" }, { ".env": "DEV_AUTH_USER_ID=user_dev_1\n" }).kind).toBe(
      "start",
    );
    expect(
      lan({}, { ".env.local": "DEV_AUTH_USER_ID=\n", ".env": "DEV_AUTH_USER_ID=user_dev_1\n" })
        .kind,
    ).toBe("start");
    expect(
      lan({}, { ".env.local": "DEV_AUTH_USER_ID=user_dev_1\n", ".env": "DEV_AUTH_USER_ID=\n" })
        .kind,
    ).toBe("refuse");
  });

  it("says where the dev session was found and never quotes the id", () => {
    const plan = lan({}, { "../../.env": "DEV_AUTH_USER_ID=user_dev_1\n" });

    expect(plan.kind === "refuse" ? plan.reason : "").toContain("repo-root .env");
    expect(plan.kind === "refuse" ? plan.reason : "").not.toContain("user_dev_1");
  });
});
