import { ConfirmPrompt, isCancel, TextPrompt } from "@clack/core";
import {
  constants as fsConstants,
  createReadStream,
  createWriteStream,
  type WriteStream,
} from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isSea } from "node:sea";
import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

import { shownPathSchema } from "@mktrue/contracts";
import type { Finding, Question } from "@mktrue/core";
import { questionsFor } from "@mktrue/core";

import { readOnlyGit } from "./git.js";
import { selfLayout, skillHomeOf } from "./self.js";
import { type Host, processHost, resolveOnWindows, spawnCommand } from "./spawn.js";
import { clip, columns, printable, terminalColumns } from "./report.js";
import {
  type AuditPorts,
  CANCELLED,
  type FileSystem,
  type InterruptGuard,
  type LinkInspection,
  type LinkOutcome,
  type Machine,
  type OpenBench,
  type Output,
  type Prompt,
  type ReadOnlyFileSystem,
  type Runner,
  type SiblingPorts,
  type TargetState,
  type TranscriptEntry,
  type TranscriptStore,
  type Workspace,
} from "./ports.js";

export class PathEscapesRepository extends Error {
  constructor(readonly path: string) {
    super(`refused: ${path} resolves outside the repository`);
    this.name = "PathEscapesRepository";
  }
}

async function realPathOfNearest(full: string): Promise<string> {
  let head = full;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await realpath(head);
      return tail.length === 0 ? real : join(real, ...tail);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = dirname(head);
      if (parent === head) return full;
      tail.unshift(basename(head));
      head = parent;
    }
  }
}

export function nodeFileSystem(root: string, options: { exclusive?: boolean } = {}): FileSystem {
  const base = resolve(root);
  let realBase: string | undefined;

  const within = async (path: string): Promise<string> => {
    const full = resolve(base, path);
    if (full !== base && !full.startsWith(base + sep)) throw new PathEscapesRepository(path);
    realBase ??= await realPathOfNearest(base);
    const real = await realPathOfNearest(full);
    if (real !== realBase && !real.startsWith(realBase + sep)) {
      throw new PathEscapesRepository(path);
    }
    return full;
  };

  return {
    async read(path) {
      try {
        return await readFile(await within(path), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
    },

    async write(path, content, executable = false) {
      const full = await within(path);
      await mkdir(dirname(full), { recursive: true });
      if (options.exclusive !== true) {
        await writeFile(full, content, "utf8");
        return;
      }
      const file = await open(full, "wx");
      try {
        await file.writeFile(content, "utf8");
        if (executable) await file.chmod(0o755);
      } finally {
        await file.close();
      }
    },

    async rename(from, to) {
      const target = await within(to);
      const origin = await within(from);
      await mkdir(dirname(target), { recursive: true });
      await rename(origin, target);
    },

    async remove(path) {
      await rm(await within(path), { force: true });
    },

    async list(dir) {
      let found: string[];
      try {
        found = (await readdir(await within(dir), { recursive: true, withFileTypes: true }))
          .filter((entry) => entry.isFile())
          .map((entry) => relative(base, join(entry.parentPath, entry.name)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
      return found.map((p) => p.split(sep).join("/")).sort();
    },
  };
}

export function openBench(trustedKit: string | undefined): OpenBench {
  return (dir) =>
    dir !== undefined
      ? nodeFileSystem(resolve(dir))
      : trustedKit === undefined
        ? undefined
        : nodeFileSystem(trustedKit);
}

export class SourceRefused extends Error {
  constructor(
    readonly path: string,
    readonly detail: string,
    readonly code: string,
  ) {
    super(`${path} ${detail}`);
    this.name = "SourceRefused";
  }
}

export async function openSourceRepository(root: string): Promise<ReadOnlyFileSystem> {
  const full = resolve(root);

  let real: string;
  try {
    real = await realpath(full);
  } catch {
    throw new SourceRefused(full, "does not exist", "NOT_FOUND");
  }
  if (real !== full) {
    throw new SourceRefused(
      full,
      `resolves through a link to ${real}; name that path instead`,
      "IS_A_LINK",
    );
  }
  if (!(await stat(real)).isDirectory())
    throw new SourceRefused(full, "is not a directory", "NOT_A_DIRECTORY");

  const { read, list } = nodeFileSystem(real);
  if ((await read(".mktrue.json")) === undefined) {
    throw new SourceRefused(
      full,
      "has no readable .mktrue.json, so it declares no answers",
      "NO_MKTRUE_JSON",
    );
  }
  return { read, list };
}

export function terminalOutput(stream: NodeJS.WriteStream = process.stdout): Output {
  const colour =
    process.env["NO_COLOR"] !== undefined || !stream.isTTY
      ? null
      : process.env["COLORTERM"] === "truecolor" || process.env["COLORTERM"] === "24bit"
        ? (s: string) => `\u001b[38;2;245;163;0m${s}\u001b[0m`
        : (s: string) => `\u001b[38;5;214m${s}\u001b[0m`;

  const say = (text: string) => stream.write(`${text}\n`);

  return {
    columns: terminalColumns(stream.isTTY === true, stream.columns),
    line: say,
    finding(finding: Finding) {
      say(`mktrue: ✗ ${finding.gate} · ${finding.what}`);
      say(`  why   ${finding.why}`);
      say(`  fix   ${finding.fix}`);
    },
    verdict(text: string) {
      say(colour ? colour(text) : text);
    },
  };
}

export function jsonOutput(stream: NodeJS.WriteStream = process.stdout): Output & {
  flush(exit: number): void;
} {
  const lines: string[] = [];
  const findings: Finding[] = [];
  return {
    line: (text) => void lines.push(text),
    finding: (finding) => void findings.push(finding),
    verdict: (text) => void lines.push(text),
    flush(exit) {
      stream.write(`${JSON.stringify({ lines, findings, exit })}\n`);
    },
  };
}

export function nodeWorkspace(root: string): Workspace {
  const base = resolve(root);
  const inspect = async (name: string): Promise<TargetState> => {
    let entry;
    try {
      entry = await lstat(join(base, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
      throw error;
    }
    if (!entry.isDirectory()) return "occupied";
    return (await readdir(join(base, name))).length === 0 ? "empty" : "occupied";
  };

  return {
    async readAnswers(path) {
      try {
        return await readFile(resolve(base, path), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
    },

    inspect,

    async makeTemporary(name) {
      const path = await mkdtemp(join(base, `.${name}.mktrue-new-`));
      const tree = basename(path);
      const log = `${tree}.log`;
      try {
        await writeFile(join(base, log), "", { flag: "wx", mode: 0o600 });
      } catch (error) {
        await rm(path, { recursive: true, force: true });
        throw error;
      }
      return { name: tree, log, fs: nodeFileSystem(path, { exclusive: true }) };
    },

    async moveIntoPlace(tree, name) {
      await chmod(join(base, tree.name), 0o755);
      await rename(join(base, tree.name), join(base, name));
    },

    async removeTemporary(tree) {
      await rm(join(base, tree.name), { recursive: true, force: true });
      await rm(join(base, tree.log), { force: true });
    },

    async removeLog(tree) {
      await rm(join(base, tree.log), { force: true });
    },
  };
}

const openLog = (path: string | undefined) =>
  new Promise<WriteStream | undefined>((opened, fail) => {
    if (path === undefined) {
      opened(undefined);
      return;
    }
    const log = createWriteStream(path, { flags: "a" });
    log.once("error", fail);
    log.once("ready", () => opened(log));
  });

const exitOf = async (
  argv: readonly string[],
  options: { cwd: string; log?: string; env?: NodeJS.ProcessEnv; host?: Host },
) => {
  const log = await openLog(options.log);
  return new Promise<{ code: number | null; stdout: string }>((done, fail) => {
    if (argv.length === 0) {
      log?.end();
      fail(new Error("nothing to run"));
      return;
    }
    log?.on("error", fail);
    log?.write(`$ ${argv.join(" ")}\n`);
    let child;
    try {
      child = spawnCommand(
        argv,
        { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] },
        options.host,
      );
    } catch (error) {
      log?.end();
      fail(error);
      return;
    }
    if (child === undefined) {
      if (log === undefined) done({ code: null, stdout: "" });
      else log.end(() => done({ code: null, stdout: "" }));
      return;
    }
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      if (log === undefined) stdout += chunk.toString("utf8");
      else log.write(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => log?.write(chunk));
    child.on("error", (error) => {
      log?.end();
      if ((error as NodeJS.ErrnoException).code === "ENOENT") done({ code: null, stdout: "" });
      else fail(error);
    });
    child.on("close", (code) => {
      if (log === undefined) done({ code, stdout });
      else log.end(() => done({ code, stdout }));
    });
  });
};

export function nodeRunner(root: string, host: Host = processHost()): Runner {
  const base = resolve(root);
  return {
    async probe(argv, tree) {
      const cwd = tree === undefined ? base : join(base, tree.name);
      const { code, stdout } = await exitOf(argv, { cwd, host });
      return code === 0 ? stdout.trim() : undefined;
    },

    async run(argv, tree) {
      const started = performance.now();
      const { code } = await exitOf(argv, {
        cwd: join(base, tree.name),
        log: join(base, tree.log),
        host,
      });
      return { ok: code === 0, seconds: (performance.now() - started) / 1000 };
    },
  };
}

/** Probes `pnpm --version` pinned to `pin`, in a scratch tree it makes and removes. */
export function pnpmProbeRunner(pin: string): Runner {
  return {
    async probe(argv) {
      const dir = await mkdtemp(join(tmpdir(), "mktrue-doctor-pnpm-"));
      try {
        await writeFile(
          join(dir, "package.json"),
          `${JSON.stringify({ packageManager: `pnpm@${pin}` })}\n`,
          "utf8",
        );
        const { code, stdout } = await exitOf(argv, {
          cwd: dir,
          env: {
            ...process.env,
            // Corepack's own switch; a standalone pnpm (npm i -g pnpm, the
            // install script, Homebrew) never reads it.
            COREPACK_ENABLE_NETWORK: "0",
            // pnpm >=10's own switch, so a standalone pnpm does not download
            // the pin from the registry when it differs from the ambient one.
            npm_config_manage_package_manager_versions: "false",
          },
        });
        return code === 0 ? stdout.trim() : undefined;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    async run() {
      throw new Error("pnpmProbeRunner only probes; it never runs gates");
    },
  };
}

/** Reads only `model`; a getter on any other key is never touched. */
export function extractModel(settings: unknown): string | undefined {
  if (settings === null || typeof settings !== "object") return undefined;
  const model = (settings as Record<string, unknown>)["model"];
  return typeof model === "string" ? model : undefined;
}

function configDirFrom(env: NodeJS.ProcessEnv): string {
  const configured = env["CLAUDE_CONFIG_DIR"];
  return configured !== undefined && configured !== "" ? configured : join(homedir(), ".claude");
}

/**
 * Reads `path` only when it is a regular file no larger than `maxBytes`; a
 * FIFO, a device or anything oversized reads as undefined instead of
 * blocking or exhausting memory. `O_NONBLOCK` matters here: a blocking open
 * of a FIFO with no writer already hangs before `fstat` ever runs.
 */
async function readCapped(path: string, maxBytes: number): Promise<string | undefined> {
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
  } catch {
    return undefined;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) return undefined;
    return await handle.readFile("utf8");
  } catch {
    return undefined;
  } finally {
    await handle.close();
  }
}

const SETTINGS_MAX_BYTES = 1024 * 1024;

const SKILL_MAX_BYTES = 64 * 1024;

/**
 * `hooks.beforeRelinkCheck` is only ever set by a test: it runs after the
 * staging link exists and right before `relinkOurs` re-inspects `path`, so
 * a test can plant a race in that exact window without a second process.
 */
export interface MachineTestHooks {
  beforeRelinkCheck?: () => Promise<void>;
}

/**
 * The script an npm `.cmd` shim runs, from the shim's own text; the shim
 * is read, never run. Undefined when the text is not an npm shim.
 */
export function npmShimTarget(shim: string, text: string): string | undefined {
  const match = /"%(?:dp0%|~dp0)\\([^"%\r\n]+)"[ \t]+%\*/u.exec(text);
  if (match?.[1] === undefined) return undefined;
  return join(dirname(shim), ...match[1].split(/[\\/]/u).filter((part) => part !== ""));
}

const SHIM_MAX_BYTES = 16 * 1024;

async function whichOnWindows(host: Host): Promise<string | undefined> {
  const found = resolveOnWindows("mktrue", host);
  if (found === undefined) return undefined;
  const ext = found.slice(found.lastIndexOf(".")).toLowerCase();
  const text =
    ext === ".cmd" || ext === ".bat" ? await readCapped(found, SHIM_MAX_BYTES) : undefined;
  const script = text === undefined ? undefined : npmShimTarget(found, text);
  for (const candidate of script === undefined ? [found] : [script, found]) {
    try {
      return await realpath(candidate);
    } catch {
      continue;
    }
  }
  return undefined;
}

/** `bundlePath` is this running bundle's own file, before it is resolved. */
export function nodeMachine(
  bundlePath: string,
  hooks: MachineTestHooks = {},
  host: Host & { symlink?: typeof symlink } = processHost(),
  inSea: () => boolean = isSea,
): Machine {
  const configDir = () => configDirFrom(host.env);
  const link = (target: string, path: string) =>
    host.platform === "win32"
      ? (host.symlink ?? symlink)(target, path, "junction")
      : (host.symlink ?? symlink)(target, path);

  const inspectLink = async (path: string): Promise<LinkInspection> => {
    let entry;
    try {
      entry = await lstat(path);
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT"
        ? { kind: "missing" }
        : { kind: "other" };
    }
    if (!entry.isSymbolicLink()) return { kind: "other" };
    try {
      return { kind: "link", realPath: await realpath(path) };
    } catch {
      return { kind: "dangling" };
    }
  };

  return {
    nodeVersion: () => process.version,

    configDir,

    async whichMktrue() {
      if (host.platform === "win32") return whichOnWindows(host);
      const entries = (host.env["PATH"] ?? "")
        .split(delimiter)
        .filter((dir) => dir !== "" && isAbsolute(dir));
      for (const dir of entries) {
        const candidate = join(dir, "mktrue");
        try {
          await lstat(candidate);
        } catch {
          continue;
        }
        try {
          return await realpath(candidate);
        } catch {
          continue;
        }
      }
      return undefined;
    },

    homeDir: () => homedir(),

    async selfPath() {
      try {
        return await realpath(bundlePath);
      } catch {
        return bundlePath;
      }
    },

    async skillHome() {
      const home = skillHomeOf(selfLayout(bundlePath, inSea));
      if (home === undefined) return undefined;
      try {
        await stat(join(home, "skill", "mktrue", "SKILL.md"));
      } catch {
        return undefined;
      }
      return home;
    },

    inspectLink,

    async readSkillName(dir) {
      const text = await readCapped(join(dir, "SKILL.md"), SKILL_MAX_BYTES);
      if (text === undefined) return undefined;
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(text);
      if (frontmatter === undefined || frontmatter === null) return undefined;
      const match = /^name:\s*(\S+)\s*$/mu.exec(frontmatter[1] ?? "");
      return match?.[1];
    },

    async readSettingsModel() {
      const text = await readCapped(join(configDir(), "settings.json"), SETTINGS_MAX_BYTES);
      if (text === undefined) return undefined;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return undefined;
      }
      return extractModel(parsed);
    },

    async linkFresh(target, path): Promise<LinkOutcome> {
      await mkdir(dirname(path), { recursive: true });
      try {
        await link(target, path);
        return "linked";
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") return "in-the-way";
        throw error;
      }
    },

    async relinkOurs(target, path, expectedRealPath): Promise<LinkOutcome> {
      await mkdir(dirname(path), { recursive: true });
      const staging = `${path}.mktrue-doctor-${process.pid}-${Date.now()}`;
      await link(target, staging);
      try {
        await hooks.beforeRelinkCheck?.();
        const again = await inspectLink(path);
        if (again.kind !== "link" || again.realPath !== expectedRealPath) return "in-the-way";
        // A rename cannot replace a directory junction on Windows; the old
        // junction is our own link, re-inspected just above, never its target.
        if (host.platform === "win32") await unlink(path);
        await rename(staging, path);
        return "linked";
      } catch {
        return "in-the-way";
      } finally {
        await rm(staging, { force: true });
      }
    },

    async realDir(dir) {
      try {
        return await realpath(dir);
      } catch {
        return dir;
      }
    },
  };
}

export function localDate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const sanitizeAnswer = printable;

const PAD_WIDTH = Math.max(...questionsFor("application").map((q) => q.label.length)) + 1;

const CURSOR = "▌";

export interface RenderableText {
  readonly state: string;
  readonly userInput: string;
  readonly value: string | undefined;
}

export function textRender(question: Question) {
  return function (this: RenderableText): string {
    const label = question.label.padEnd(PAD_WIDTH);
    if (this.state === "submit") {
      const prefix = `mktrue: ${label}· `;
      const value = sanitizeAnswer(this.value ?? "");
      const shown = value.trim() === "" ? (question.default ?? "") : value;
      return `${prefix}${clip(shown, columns() - prefix.length)}`;
    }
    if (this.state === "cancel") return "";
    const hintLine = `mktrue: ${label}· ${question.hint}`;
    const typed = sanitizeAnswer(this.userInput);
    const shown =
      typed.length > 0 ? typed : question.default !== undefined ? `[${question.default}]` : "";
    const prefix = `mktrue: ${label}› `;
    const inputLine = `${prefix}${clip(shown, columns() - prefix.length - 1)}${CURSOR}`;
    return `${hintLine}\n${inputLine}`;
  };
}

export interface RenderableConfirm {
  readonly state: string;
  readonly value: boolean | undefined;
}

export function confirmRender(text: string) {
  return function (this: RenderableConfirm): string {
    if (this.state === "submit") return `mktrue: ${text} · ${this.value ? "yes" : "no"}`;
    if (this.state === "cancel") return "";
    return `mktrue: ${text} · Y/n`;
  };
}

// Clack settles on neither a raw 0x04 (Ctrl-D in a pty) nor an ended pipe;
// an abort is its own cancel path.
function abortOnInputEnd(input: Readable): { signal: AbortSignal; stop: () => void } {
  const controller = new AbortController();
  const onEnd = () => controller.abort();
  const onKeypress = (_char: string, key?: { name?: string; ctrl?: boolean }) => {
    if (key?.ctrl === true && key.name === "d") controller.abort();
  };
  input.once("end", onEnd);
  input.once("close", onEnd);
  input.on("keypress", onKeypress);
  return {
    signal: controller.signal,
    stop: () => {
      input.off("end", onEnd);
      input.off("close", onEnd);
      input.off("keypress", onKeypress);
    },
  };
}

export function clackPrompt(input: Readable, output: Writable, interactive: boolean): Prompt {
  return {
    interactive,

    async ask(question) {
      const { signal, stop } = abortOnInputEnd(input);
      const prompt = new TextPrompt({ input, output, render: textRender(question), signal });
      const value = await prompt.prompt();
      stop();
      if (isCancel(value)) return CANCELLED;
      // What is drawn is sanitised by the render function; what is
      // returned is what was typed, so checkReply refuses a control or
      // invisible character the same way the answers-file door does.
      return String(value ?? "");
    },

    async confirm(text) {
      const { signal, stop } = abortOnInputEnd(input);
      const prompt = new ConfirmPrompt({
        input,
        output,
        active: "Y",
        inactive: "n",
        initialValue: true,
        render: confirmRender(text),
        signal,
      });
      const value = await prompt.prompt();
      stop();
      if (isCancel(value)) return CANCELLED;
      return value === true;
    },
  };
}

export function processInterruptGuard(): InterruptGuard {
  return {
    arm(onInterrupt) {
      const handler = () => process.exit(onInterrupt());
      process.once("SIGINT", handler);
      return () => process.off("SIGINT", handler);
    },
  };
}

/** A terminal to ask in needs both ends: stdin to read, stdout to draw on. */
export function isInteractive(stdinIsTTY: boolean, stdoutIsTTY: boolean): boolean {
  return stdinIsTTY && stdoutIsTTY;
}

export function nodePrompt(): Prompt {
  const interactive = isInteractive(process.stdin.isTTY === true, process.stdout.isTTY === true);
  return clackPrompt(process.stdin, process.stdout, interactive);
}

const SMALL_FILE_MAX_BYTES = 1024 * 1024;

const withoutCr = (line: string) => (line.endsWith("\r") ? line.slice(0, -1) : line);

/** Ends a line at `\n` only: JSON leaves U+2028 and U+2029 raw inside a string. */
async function* splitLines(chunks: AsyncIterable<Buffer>): AsyncGenerator<string> {
  const decoder = new StringDecoder("utf8");
  let rest = "";
  for await (const chunk of chunks) {
    const text = decoder.write(chunk);
    let start = 0;
    for (let end = text.indexOf("\n"); end !== -1; end = text.indexOf("\n", start)) {
      yield withoutCr(rest + text.slice(start, end));
      rest = "";
      start = end + 1;
    }
    rest += text.slice(start);
  }
  rest += decoder.end();
  if (rest !== "") yield withoutCr(rest);
}

export function nodeTranscriptStore(): TranscriptStore {
  return {
    async realPath(path) {
      try {
        return await realpath(path);
      } catch {
        return undefined;
      }
    },

    async entries(dir) {
      let listed;
      try {
        listed = await readdir(dir, { withFileTypes: true });
      } catch {
        return undefined;
      }
      const found: TranscriptEntry[] = [];
      for (const entry of listed) {
        let kind: { isFile(): boolean; isDirectory(): boolean } = entry;
        if (entry.isSymbolicLink()) {
          try {
            kind = await stat(join(dir, entry.name));
          } catch {
            continue;
          }
        }
        if (kind.isFile()) found.push({ name: entry.name, kind: "file" });
        else if (kind.isDirectory()) found.push({ name: entry.name, kind: "dir" });
      }
      return found;
    },

    lines: (path) => splitLines(createReadStream(path)),

    readSmall: (path) => readCapped(path, SMALL_FILE_MAX_BYTES),
  };
}

export function nodeAuditPorts(cwd: string): AuditPorts {
  return {
    runner: nodeRunner(cwd),
    store: nodeTranscriptStore(),
    configDir: () => configDirFrom(process.env),
    today: () => localDate(),
    cwd: resolve(cwd),
    async targetKind(path) {
      try {
        const kind = await lstat(path);
        return kind.isFile() ? "file" : kind.isDirectory() ? "dir" : "other";
      } catch {
        return "missing";
      }
    },
    async write(path, content) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
    },
  };
}

const isAbsoluteEntry = (entry: string): boolean =>
  isAbsolute(entry) || entry.startsWith("\\") || /^[A-Za-z]:/.test(entry);

const showable = (path: string): string | null =>
  shownPathSchema.safeParse(path).success ? path : null;

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

export function nodeSiblingPorts(root: string): SiblingPorts {
  const base = resolve(root);
  let self: string | undefined;
  const selfReal = async (): Promise<string> => (self ??= await realpath(base));

  return {
    async locate(entry) {
      if (isAbsoluteEntry(entry)) return { kind: "unreadable", shown: null, why: "it is absolute" };
      if (entry.startsWith("~")) {
        return { kind: "unreadable", shown: null, why: "it starts with ~, which is not expanded" };
      }
      const home = await selfReal();
      const full = resolve(home, entry);
      const named = showable(relative(home, full).split(sep).join("/") || ".");
      if (named === null) {
        return {
          kind: "unreadable",
          shown: null,
          why: "it climbs above this repository's parent",
          refused: true,
        };
      }

      let real: string;
      try {
        real = await realpath(full);
      } catch {
        return { kind: "unreadable", shown: named, why: "it does not exist" };
      }
      const shown = showable(relative(home, real).split(sep).join("/") || ".");
      if (shown === null) return { kind: "unreadable", shown, why: "its path cannot be shown" };
      if (!(await stat(real)).isDirectory()) {
        return { kind: "unreadable", shown, why: "it is not a directory" };
      }
      if (!(await exists(join(real, ".git")))) {
        return { kind: "unreadable", shown, why: "it is not a git repository" };
      }
      if (!(await exists(join(real, ".mktrue.json")))) {
        return { kind: "unreadable", shown, why: "it has no .mktrue.json" };
      }

      const git = readOnlyGit(real);
      if ((await git.topLevel()) !== real) {
        return { kind: "unreadable", shown, why: "its .git is not a repository of its own" };
      }

      return {
        kind: "found",
        shown,
        git,
        async baseBranch() {
          try {
            const text = await nodeFileSystem(real).read(".mktrue.json");
            const parsed: unknown = text === undefined ? undefined : JSON.parse(text);
            if (parsed === null || typeof parsed !== "object") return undefined;
            const branch = (parsed as Record<string, unknown>)["baseBranch"];
            return typeof branch === "string" ? branch : undefined;
          } catch {
            return undefined;
          }
        },
        async listsBack(entries) {
          for (const listed of entries) {
            if (isAbsoluteEntry(listed)) continue;
            try {
              if ((await realpath(resolve(real, listed))) === home) return true;
            } catch {
              continue;
            }
          }
          return false;
        },
      };
    },
  };
}
