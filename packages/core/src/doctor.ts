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
