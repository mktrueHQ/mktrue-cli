import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const WEB = join(import.meta.dirname, "..", "..");

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

const withoutComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const SHIPPED = [
  ...["app", "lib", "i18n"].flatMap((directory) => sources(join(WEB, directory))),
  join(WEB, "proxy.ts"),
].map((path) => ({ path: relative(WEB, path), code: withoutComments(readFileSync(path, "utf8")) }));

const filesWhere = (pattern: RegExp) =>
  SHIPPED.filter((file) => pattern.test(file.code))
    .map((file) => file.path)
    .toSorted();

describe("where the web tier learns who is calling", () => {
  it("walks the web tier's code", () => {
    expect(SHIPPED.map((file) => file.path)).toEqual(
      expect.arrayContaining(["lib/api.ts", "lib/owner-token.ts", "app/page.tsx", "proxy.ts"]),
    );
  });

  it("asks the session for it in one file", () => {
    expect(filesWhere(/\bauth\s*\(/)).toEqual(["lib/owner-token.ts"]);
    expect(filesWhere(/\bgetToken\b/)).toEqual(["lib/owner-token.ts"]);
  });

  it("hands the token on in one file, which alone calls the API", () => {
    expect(filesWhere(/\bownerToken\b/)).toEqual(["lib/api.ts", "lib/owner-token.ts"]);
    expect(filesWhere(/\bfetch\s*\(/)).toEqual(["lib/api.ts"]);
  });

  it("reads no cookie and no request header on the way to the API", () => {
    expect(filesWhere(/\bcookies\s*\(/)).toEqual([]);
    expect(filesWhere(/\bheaders\s*\(\s*\)/)).toEqual(["i18n/request.ts"]);
  });

  it.each([
    ["an auth() call", "const { userId } = await auth();", /\bauth\s*\(/],
    ["a fetch of its own", 'await fetch("/api/x", { headers });', /\bfetch\s*\(/],
    ["a cookie read", 'const who = (await cookies()).get("user");', /\bcookies\s*\(/],
  ])("would see %s in any other file", (_case, code, pattern) => {
    expect(pattern.test(withoutComments(code))).toBe(true);
    expect(pattern.test(withoutComments(`// ${code}`))).toBe(false);
  });
});
