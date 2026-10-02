import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isSea } from "node:sea";

export const PACKAGE_NAME = "mktrue";
export const KIT_ROOT_NAME = "mktrue-kit";

/** Where the running bundle sits: its npm package, and the kit checkout around it, if trusted. */
export interface SelfLayout {
  readonly packageRoot: string | undefined;
  readonly kit: string | undefined;
}

const manifestAt = (dir: string): Readonly<Record<string, unknown>> | undefined => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

const NO_LAYOUT: SelfLayout = { packageRoot: undefined, kit: undefined };

/** The file this process runs: the binary itself when it is a single executable, else the bundle. */
export const runningFile = (inSea: () => boolean = isSea): string =>
  inSea() ? process.execPath : (process.argv[1] ?? process.execPath);

export function selfLayout(bundlePath: string, inSea: () => boolean = isSea): SelfLayout {
  if (inSea()) return NO_LAYOUT;
  let bundle: string;
  try {
    bundle = realpathSync(bundlePath);
  } catch {
    bundle = bundlePath;
  }
  const packageRoot = resolve(dirname(bundle), "..");
  if (manifestAt(packageRoot)?.["name"] !== PACKAGE_NAME) {
    return NO_LAYOUT;
  }
  const kit = resolve(packageRoot, "..", "..");
  const root = manifestAt(kit);
  const trusted = root?.["name"] === KIT_ROOT_NAME && root["private"] === true;
  return { packageRoot, kit: trusted ? kit : undefined };
}

/** The directory whose `skill/mktrue` doctor links: a kit checkout first, else the npm package. */
export const skillHomeOf = (layout: SelfLayout): string | undefined =>
  layout.kit ?? layout.packageRoot;
