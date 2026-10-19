import type { PnpmRequirement } from "./new.js";

/** Doctor's own minimum: the version pin this kit is built and tested against. */
const MIN_NODE_MAJOR = 24;

export function nodeSatisfies(version: string): boolean {
  const match = /^\s*v?(\d+)\./u.exec(version);
  if (match === null) return false;
  return Number(match[1]) >= MIN_NODE_MAJOR;
}

/** The pnpm major doctor requires, fed to `pnpmSatisfies` from `new.js`. */
export const REQUIRED_PNPM: PnpmRequirement = { major: 11, orNewer: true };

export function isOneMillionModel(value: string | undefined): boolean {
  return value !== undefined && /\[1m\]/iu.test(value);
}

/** The exact pnpm version a template's `packageManager` field pins, or undefined. */
export function pnpmPin(packageJson: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJson);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object") return undefined;
  const value = (parsed as Record<string, unknown>)["packageManager"];
  if (typeof value !== "string") return undefined;
  return /^pnpm@(\d+\.\d+\.\d+)/u.exec(value)?.[1];
}

/** The `name` a role file's frontmatter gives, or undefined when it has none. */
export function roleFileName(text: string): string | undefined {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text)?.[1];
  if (frontmatter === undefined) return undefined;
  for (const line of frontmatter.split(/\r?\n/u)) {
    const value = /^name:[ \t]*(.*?)[ \t]*$/u.exec(line)?.[1];
    if (value === undefined) continue;
    const name = value.replace(/^(["'])(.*)\1$/u, "$2");
    return name === "" ? undefined : name;
  }
  return undefined;
}

/** Every role whose file is missing, or whose frontmatter does not name it. */
export function missingRoleFiles(
  roles: readonly string[],
  files: ReadonlyMap<string, string | undefined>,
): string[] {
  return roles.filter((role) => {
    const text = files.get(role);
    return text === undefined || roleFileName(text) !== role;
  });
}
