import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const EXAMPLE = readFileSync(join(ROOT, ".env.example"), "utf8");

/** The files a variable can be read from: the two typed configs and what sits beside them. */
const CONFIG_ROOTS = ["apps/web/lib", "apps/web/next.config.ts", "services/api/src/app"];

function sources(path: string): string[] {
  const absolute = join(ROOT, path);
  if (!existsSync(absolute)) return [];
  if (/\.tsx?$/.test(path)) return [readFileSync(absolute, "utf8")];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() || /\.tsx?$/.test(entry.name) ? sources(join(path, entry.name)) : [],
  );
}

const variables = [...EXAMPLE.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1] ?? "");

const NAMED_FILE = /(?:[\w.@[\]-]+\/)*[\w.-]+\.(?:ya?ml|json|tsx?|m?js|sh|md)\b|\bDockerfile\b/g;

describe(".env.example", () => {
  const read = CONFIG_ROOTS.flatMap(sources).join("\n");

  it("lists variables at all, so the checks below are not vacuous", () => {
    expect(variables.length).toBeGreaterThan(10);
    expect(read.length).toBeGreaterThan(0);
  });

  it.each(variables)("%s is read by a config this repository holds", (name) => {
    expect(read).toMatch(new RegExp(`\\benv\\.${name}\\b`));
  });

  it("names no file this repository does not hold", () => {
    const missing = [...new Set(EXAMPLE.match(NAMED_FILE) ?? [])].filter(
      (path) => !existsSync(join(ROOT, path)),
    );

    expect(missing).toEqual([]);
  });

  it("names the files it does hold, so that check is not vacuous either", () => {
    expect(EXAMPLE.match(NAMED_FILE) ?? []).toContain("apps/web/lib/config.ts");
  });
});
