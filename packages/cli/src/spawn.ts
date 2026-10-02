import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { statSync } from "node:fs";
import { basename, extname, isAbsolute, join } from "node:path";

import { EXIT, type ExitCode } from "@mktrue/core";

import type { Output } from "./ports.js";
import { clip, COLUMNS, printable, refuse } from "./report.js";

/** The machine a command is resolved on; injected so Windows rules run under test on any OS. */
export interface Host {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  isFile(path: string): boolean;
}

export const processHost = (): Host => ({
  platform: process.platform,
  env: process.env,
  isFile(path) {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  },
});

export interface Invocation {
  readonly file: string;
  readonly args: readonly string[];
  readonly windowsVerbatimArguments: boolean;
  /** Only for `cmd.exe`: the child's environment, which then never searches the working directory. */
  readonly env?: NodeJS.ProcessEnv;
}

export class UnsafeShellArgument extends Error {
  constructor(
    readonly command: string,
    readonly character: string,
  ) {
    super(`refused: an argument to ${command} holds ${character}`);
    this.name = "UnsafeShellArgument";
  }
}

const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";
const DIRECT = new Set([".exe", ".com"]);
const THROUGH_CMD = new Set([".cmd", ".bat"]);
const UNESCAPABLE = /[\u0000-\u0008\u000a-\u001f\u007f%!"]/u;
const NO_CWD_SEARCH = "NoDefaultCurrentDirectoryInExePath";

export function envValue(
  env: NodeJS.ProcessEnv,
  name: string,
  platform: NodeJS.Platform,
): string | undefined {
  if (platform !== "win32") return env[name];
  const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

function extensions(env: NodeJS.ProcessEnv): string[] {
  const listed = envValue(env, "PATHEXT", "win32") ?? DEFAULT_PATHEXT;
  return listed
    .split(";")
    .map((ext) => ext.trim().toLowerCase())
    .filter((ext) => ext.startsWith(".") && ext.length > 1);
}

const runnable = (path: string) => {
  const ext = extname(path).toLowerCase();
  return DIRECT.has(ext) || THROUGH_CMD.has(ext);
};

/**
 * Where Windows would find `command`: each absolute `PATH` entry in order,
 * each `PATHEXT` extension in order within it. The working directory is
 * never searched, and only an `.exe`, `.com`, `.cmd` or `.bat` is returned.
 */
export function resolveOnWindows(command: string, host: Host): string | undefined {
  const exts = extensions(host.env);
  const named = (base: string) => {
    const own = extname(base).toLowerCase();
    return [...(exts.includes(own) ? [base] : []), ...exts.map((ext) => `${base}${ext}`)];
  };
  const dirs = /[\\/]/u.test(command)
    ? [""]
    : (envValue(host.env, "PATH", "win32") ?? "")
        .split(";")
        .filter((dir) => dir !== "" && isAbsolute(dir));
  for (const dir of dirs) {
    for (const name of named(command)) {
      const candidate = dir === "" ? name : join(dir, name);
      if (runnable(candidate) && host.isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

/**
 * One argument as `cmd.exe /d /s /c` and the batch file it starts both read
 * it: always quoted, so `&`, `|`, `^`, `<`, `>`, `(`, `)` and spaces are
 * literal, with trailing backslashes doubled so the closing quote stays a
 * quote. `%`, `!`, `"`, a line break and any other control character have
 * no escape both layers honour, so they are refused.
 */
export function quoteForCmd(arg: string, command: string): string {
  const bad = UNESCAPABLE.exec(arg);
  if (bad !== null) throw new UnsafeShellArgument(command, describe(bad[0]));
  return `"${arg.replace(/(\\+)$/u, "$1$1")}"`;
}

function describe(character: string): string {
  if (character === "\n" || character === "\r") return "a line break";
  if (/[%!"]/u.test(character)) return character;
  return "a control character";
}

/** Undefined when the command is not found; throws `UnsafeShellArgument` for what cannot be escaped. */
export function planInvocation(argv: readonly string[], host: Host): Invocation | undefined {
  const [command, ...args] = argv;
  if (command === undefined) throw new Error("nothing to run");
  if (host.platform !== "win32") return { file: command, args, windowsVerbatimArguments: false };

  const resolved = resolveOnWindows(command, host);
  if (resolved === undefined) return undefined;
  if (DIRECT.has(extname(resolved).toLowerCase())) {
    return { file: resolved, args, windowsVerbatimArguments: false };
  }
  const shown = basename(resolved);
  const line = [resolved, ...args].map((arg) => quoteForCmd(arg, shown)).join(" ");
  const systemRoot = envValue(host.env, "SystemRoot", "win32") ?? "C:\\Windows";
  const cmd = envValue(host.env, "ComSpec", "win32") ?? join(systemRoot, "System32", "cmd.exe");
  const env = Object.fromEntries(
    Object.entries(host.env).filter(([key]) => key.toUpperCase() !== NO_CWD_SEARCH.toUpperCase()),
  );
  return {
    file: cmd,
    args: ["/d", "/s", "/c", `"${line}"`],
    windowsVerbatimArguments: true,
    env: { ...env, [NO_CWD_SEARCH]: "1" },
  };
}

/**
 * Every child process the CLI starts goes through here. Undefined when the
 * command is not found, which callers read as ENOENT.
 */
export function spawnCommand(
  argv: readonly string[],
  options: Omit<SpawnOptions, "shell" | "windowsVerbatimArguments">,
  host: Host = processHost(),
  start: typeof spawn = spawn,
): ChildProcess | undefined {
  const plan = planInvocation(argv, { ...host, env: options.env ?? host.env });
  if (plan === undefined) return undefined;
  return start(plan.file, plan.args, {
    ...options,
    ...(plan.env === undefined ? {} : { env: plan.env }),
    shell: false,
    windowsVerbatimArguments: plan.windowsVerbatimArguments,
  });
}

export function refuseUnsafeShell(out: Output, error: UnsafeShellArgument): ExitCode {
  return refuse(
    out,
    "environment",
    clip(
      `refused to run ${printable(error.command)} · an argument holds ${error.character}`,
      COLUMNS - "mktrue: ✗ environment · ".length,
    ),
    "a .cmd runs through cmd.exe, which reads that character as its own",
    'rename the path or value so it holds no % ! " or line break',
    EXIT.ENVIRONMENT,
  );
}
