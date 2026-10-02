import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LOOPBACK_BIND_MARK } from "@/dev-session/bind";

const WEB = join(import.meta.dirname, "..", "..");

const SCRIPTS = (
  JSON.parse(readFileSync(join(WEB, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts;

function serve(argv: readonly string[], env: NodeJS.Dict<string> = {}) {
  return spawnSync(process.execPath, ["dev-session/serve.ts", ...argv], {
    cwd: WEB,
    env: { NODE_ENV: "development", PATH: process.env.PATH, ...env },
    encoding: "utf8",
    timeout: 20_000,
  });
}

describe("the scripts that start a dev server", () => {
  it("start it only through the launcher", () => {
    expect(SCRIPTS.dev).toBe("node dev-session/serve.ts");
    expect(SCRIPTS["dev:lan"]).toBe("node dev-session/serve.ts --lan");
    expect(
      Object.entries(SCRIPTS)
        .filter(([, script]) => /\bnext\b/.test(script))
        .filter(([, script]) => !/^next (build|start)\b/.test(script))
        .map(([name]) => name),
    ).toEqual([]);
  });

  it("never set the loopback mark themselves", () => {
    expect(
      Object.entries(SCRIPTS)
        .filter(([, script]) => script.includes(LOOPBACK_BIND_MARK.name))
        .map(([name]) => name),
    ).toEqual([]);
  });
});

describe("the launcher, run as dev runs it", () => {
  it("exits non-zero and starts nothing when handed a bind of its own", () => {
    const run = serve(["-H", "0.0.0.0"]);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("dev takes no arguments");
  });

  it("exits non-zero and starts nothing for dev:lan under a dev session", () => {
    const run = serve(["--lan"], { DEV_AUTH_USER_ID: "user_dev_1" });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("dev:lan refused");
    expect(run.stderr).not.toContain("user_dev_1");
  });
});
