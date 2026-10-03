import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";

import { describe, expect, it } from "vitest";

import { parseConfig } from "@/lib/config";

const ROOT = resolve(import.meta.dirname, "../../..");
const EXAMPLE = readFileSync(join(ROOT, ".env.example"), "utf8");
const API_CONFIG = readFileSync(join(ROOT, "services/api/src/app/config.ts"), "utf8");

// `cp .env.example .env` is the whole first-day step, so the copy has to point the web at the
// port the API listens on when nothing else is set.
describe(".env.example", () => {
  it("points the web at the API's own development port", () => {
    const port = /^const DEFAULT_PORT = (\d+);$/m.exec(API_CONFIG)?.[1];

    expect(port).toBeDefined();
    expect(parseConfig({ NODE_ENV: "development", ...parseEnv(EXAMPLE) }).apiBaseUrl).toBe(
      `http://localhost:${port}`,
    );
  });

  it("says beside the value that blank refuses", () => {
    const lines = EXAMPLE.split("\n");
    const at = lines.findIndex((line) => line.startsWith("API_BASE_URL="));
    const comment = lines.slice(0, at).join("\n").split("\n\n").at(-1) ?? "";

    expect(comment).toContain("Blank refuses");
  });

  it("leaves the API's own port to its default, so the two cannot disagree", () => {
    expect(parseEnv(EXAMPLE).PORT).toBeUndefined();
  });
});
