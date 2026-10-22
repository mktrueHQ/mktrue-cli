import { sessionNameSchema, type SessionAllowlist } from "@mktrue/contracts";

import { EXIT, type Finding } from "./findings.js";
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

export type SessionScope = "user" | "project" | "local";

export interface LoadedName {
  readonly name: string;
  readonly scope: SessionScope;
  /** The file it is turned off in, as the founder would type it. */
  readonly source: string;
}

export interface SessionFile {
  readonly path: string;
  readonly characters: number;
}

export interface SessionLoad {
  readonly files: readonly SessionFile[];
  readonly plugins: readonly LoadedName[];
  readonly mcpServers: readonly LoadedName[];
}

export interface SessionAllowance {
  readonly template: string;
  readonly allowlist: SessionAllowlist;
}

const list = (names: readonly string[]) => (names.length === 0 ? "none" : names.join(", "));

const level = (scope: SessionScope) => `${scope} level`;

function pluginAllowed(name: string, allowed: readonly string[]): boolean {
  const bare = name.split("@")[0] ?? name;
  return allowed.includes(name) || allowed.includes(bare);
}

function pluginFix(loaded: LoadedName): string {
  return `${level(loaded.scope)}: set enabledPlugins false in ${loaded.source}`;
}

function serverFix(loaded: LoadedName): string {
  const where = loaded.scope === "local" ? "this repository's mcpServers" : "mcpServers";
  if (loaded.scope === "project" || !sessionNameSchema.safeParse(loaded.name).success) {
    return `${level(loaded.scope)}: remove it from ${where} in ${loaded.source}`;
  }
  return `${level(loaded.scope)}: claude mcp remove ${loaded.name} --scope ${loaded.scope}`;
}

/** What a session in this repository loads, and anything outside the template's allowlist. */
export function sessionReport(
  load: SessionLoad,
  allowance: SessionAllowance | undefined,
): { lines: string[]; findings: Finding[] } {
  const lines: string[] = [];
  const findings: Finding[] = [];

  lines.push(
    allowance === undefined
      ? "mktrue: doctor · allowlist · none · this repository names no template"
      : `mktrue: doctor · allowlist · ${allowance.template} · plugins ${list(allowance.allowlist.plugins)} · mcp servers ${list(allowance.allowlist.mcpServers)}`,
  );

  for (const file of load.files) {
    lines.push(`mktrue: doctor · loads · ${file.path} · ${file.characters} characters`);
  }

  const report = (
    kind: "plugin" | "mcp server",
    loaded: LoadedName,
    allowed: boolean | undefined,
    fix: string,
  ) => {
    if (allowed === false) {
      findings.push({
        gate: "doctor",
        what: `${kind} ${loaded.name} is off the allowlist`,
        why: `the ${allowance?.template ?? ""} template does not need it; every run loads it`,
        fix,
        exit: EXIT.FINDINGS,
      });
      return;
    }
    const mark = allowed === true ? "✓ " : "";
    lines.push(`mktrue: doctor · ${kind} · ${mark}${loaded.name} · ${level(loaded.scope)}`);
  };

  if (load.plugins.length === 0) lines.push("mktrue: doctor · plugins · none enabled");
  for (const plugin of load.plugins) {
    const allowed =
      allowance === undefined ? undefined : pluginAllowed(plugin.name, allowance.allowlist.plugins);
    report("plugin", plugin, allowed, pluginFix(plugin));
  }

  if (load.mcpServers.length === 0) lines.push("mktrue: doctor · mcp servers · none configured");
  for (const server of load.mcpServers) {
    const allowed =
      allowance === undefined ? undefined : allowance.allowlist.mcpServers.includes(server.name);
    report("mcp server", server, allowed, serverFix(server));
  }

  return { lines, findings };
}
