import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  encodeProjectDir,
  READER_ID,
  readClaudeCode,
  shapeCheckTrips,
  TESTED_FROM,
  TESTED_TO,
} from "@mktrue/audit";
import {
  auditReportSchema,
  mktrueConfigSchema,
  readerEventSchema,
  type AuditEvent,
  type ReaderEvent,
  type ReaderTally,
  type SpawnEvent,
} from "@mktrue/contracts";
import {
  DEFAULT_GATES,
  EXIT,
  auditMetrics,
  renderAuditHtml,
  type AuditTranscript,
  type AuditTree,
  type ExitCode,
} from "@mktrue/core";

import type { AuditPorts, Output, TranscriptEntry, TranscriptStore } from "../ports.js";
import { columns, clip, errorCode, printable, refuse } from "../report.js";

export interface AuditOptions {
  readonly out: string | undefined;
  readonly json: boolean;
}

const WORKTREE_DIR_SUFFIX = "--claude-worktrees-";
const AGENT_FILE = /^agent-([A-Za-z0-9_-]+)\.jsonl$/;
const SESSION_DIR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DEFAULT_TARGET_DIR = "<git common dir>/mktrue";
const C1_CONTROL = /[\u0080-\u009f]/gu;

interface TranscriptFile {
  readonly path: string;
  readonly sessionId: string;
  readonly agentId?: string;
  readonly metaPath?: string;
}

interface Walk {
  readonly store: TranscriptStore;
  readonly root: string;
  outsideRoot: number;
  unreadable: number;
}

interface Read {
  readonly transcript: AuditTranscript;
  readonly tally: ReaderTally;
  readonly records: number;
  readonly spawns: readonly SpawnEvent[];
  readonly claimed: boolean;
}

interface Scan {
  readonly trees: readonly AuditTree[];
  readonly gates: readonly string[];
  readonly common: string;
}

interface Rejected {
  readonly rejected: { readonly kind: string; readonly keys: readonly string[] };
}

function strictEvent(event: unknown): ReaderEvent | Rejected {
  const parsed = readerEventSchema.safeParse(event);
  if (parsed.success) return parsed.data;
  const keys = new Set<string>();
  for (const issue of parsed.error.issues) {
    if (issue.code === "unrecognized_keys") for (const key of issue.keys) keys.add(key);
    else if (issue.path.length > 0) keys.add(String(issue.path[0]));
  }
  const kind = (event as { kind?: unknown }).kind;
  return {
    rejected: {
      kind: typeof kind === "string" ? kind : "unknown",
      keys: [...keys].sort(),
    },
  };
}

function withoutC1<T>(value: T): T {
  if (typeof value === "string") return value.replace(C1_CONTROL, "") as T;
  if (Array.isArray(value)) return value.map(withoutC1) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, field]) => [withoutC1(key), withoutC1(field)]),
    ) as T;
  }
  return value;
}

function isInsideTree(path: string, tree: string): boolean {
  if (tree === "/") return path.startsWith("/");
  return path === tree || path.startsWith(`${tree}/`);
}

function parseWorktrees(porcelain: string): string[] {
  return porcelain
    .split("\0")
    .filter((field) => field.startsWith("worktree "))
    .map((field) => field.slice("worktree ".length));
}

async function findTrees(ports: AuditPorts, top: string): Promise<AuditTree[]> {
  const listed = await ports.runner.probe(["git", "worktree", "list", "--porcelain", "-z"]);
  const paths = listed === undefined ? [] : parseWorktrees(listed);
  if (paths.length === 0) paths.push(top);
  return paths.map((path, index) => ({ path, name: index === 0 ? "." : basename(path) }));
}

function ancestorsOf(path: string): string[] {
  const found: string[] = [];
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    found.push(dir);
    if (dir === dirname(dir)) return found;
  }
}

async function findProjectDirs(
  store: TranscriptStore,
  projects: string,
  trees: readonly AuditTree[],
): Promise<string[]> {
  const existing = ((await store.entries(projects)) ?? [])
    .filter((entry) => entry.kind === "dir")
    .map((entry) => entry.name);
  const wanted = new Set<string>();
  for (const tree of trees) {
    const encoded = encodeProjectDir(tree.path);
    wanted.add(encoded);
    for (const name of existing) {
      if (name.startsWith(encoded + WORKTREE_DIR_SUFFIX)) wanted.add(name);
    }
    for (const ancestor of ancestorsOf(tree.path)) wanted.add(encodeProjectDir(ancestor));
  }
  return existing.filter((name) => wanted.has(name)).sort();
}

async function isWithinRoot(walk: Walk, path: string): Promise<boolean> {
  const real = await walk.store.realPath(path);
  if (real === undefined) {
    walk.unreadable += 1;
    return false;
  }
  if (!isInsideTree(real, walk.root)) {
    walk.outsideRoot += 1;
    return false;
  }
  return true;
}

async function list(walk: Walk, dir: string): Promise<TranscriptEntry[] | undefined> {
  if (!(await isWithinRoot(walk, dir))) return undefined;
  const entries = await walk.store.entries(dir);
  if (entries === undefined) walk.unreadable += 1;
  return entries;
}

async function subagentFiles(walk: Walk, dir: string, sessionId: string) {
  const files: TranscriptFile[] = [];
  const session = await list(walk, join(dir, sessionId));
  if (!session?.some((entry) => entry.kind === "dir" && entry.name === "subagents")) return files;
  const subagents = join(dir, sessionId, "subagents");
  const inside = (await list(walk, subagents)) ?? [];
  const metas = new Set(inside.filter((e) => e.kind === "file").map((e) => e.name));
  for (const file of inside) {
    const agentId = file.kind === "file" ? AGENT_FILE.exec(file.name)?.[1] : undefined;
    if (agentId === undefined) continue;
    const path = join(subagents, file.name);
    if (!(await isWithinRoot(walk, path))) continue;
    const metaPath = join(subagents, `agent-${agentId}.meta.json`);
    const withMeta = metas.has(basename(metaPath)) && (await isWithinRoot(walk, metaPath));
    files.push({ path, sessionId, agentId, ...(withMeta ? { metaPath } : {}) });
  }
  return files;
}

async function transcriptFiles(
  walk: Walk,
  dir: string,
  entries: readonly TranscriptEntry[],
): Promise<TranscriptFile[]> {
  const files: TranscriptFile[] = [];
  for (const entry of entries) {
    if (entry.kind === "file" && entry.name.endsWith(".jsonl")) {
      const path = join(dir, entry.name);
      if (await isWithinRoot(walk, path)) {
        files.push({ path, sessionId: entry.name.slice(0, -".jsonl".length) });
      }
    } else if (entry.kind === "dir" && SESSION_DIR.test(entry.name)) {
      files.push(...(await subagentFiles(walk, dir, entry.name)));
    }
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

async function metaOf(walk: Walk, file: TranscriptFile): Promise<unknown> {
  if (file.agentId === undefined) return undefined;
  if (file.metaPath === undefined) return {};
  const text = await walk.store.readSmall(file.metaPath);
  if (text === undefined) {
    walk.unreadable += 1;
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

function isKept(cwd: string, trees: readonly AuditTree[]): boolean {
  return isAbsolute(cwd) && trees.some((tree) => isInsideTree(resolve(cwd), tree.path));
}

function spawnOf(meta: unknown): string | undefined {
  const toolUseId = (meta as { toolUseId?: unknown } | null)?.toolUseId;
  return typeof toolUseId === "string" ? toolUseId : undefined;
}

function claimedSpawn({ toolUseId, slice, role, subagentType }: SpawnEvent): AuditEvent {
  return {
    kind: "tool_use",
    name: "Agent",
    toolUseId,
    slice,
    ...(role === undefined ? {} : { role }),
    ...(subagentType === undefined ? {} : { subagentType }),
  };
}

async function readTranscript(
  walk: Walk,
  file: TranscriptFile,
  scan: Scan,
  claims: ReadonlyMap<string, SpawnEvent>,
): Promise<Read | Rejected | undefined> {
  const meta = await metaOf(walk, file);
  const toolUseId = file.agentId === undefined ? undefined : spawnOf(meta);
  const claim = toolUseId === undefined ? undefined : claims.get(toolUseId);
  const keep = claim === undefined ? (cwd: string) => isKept(cwd, scan.trees) : undefined;
  const lines = walk.store.lines(file.path);
  const reader = readClaudeCode(lines, meta, scan.gates, keep, scan.common);
  const events: AuditEvent[] = [];
  const spawns: SpawnEvent[] = [];
  const uuids = new Set<string>();
  let records = 0;
  for (;;) {
    let step;
    try {
      step = await reader.next();
    } catch {
      walk.unreadable += 1;
      return undefined;
    }
    if (step.done === true) {
      const claimed = claim !== undefined && records > 0;
      if (claimed) events.push(claimedSpawn(claim));
      const transcript: AuditTranscript = {
        sessionId: file.sessionId,
        events,
        ...(file.agentId === undefined ? {} : { agentId: file.agentId }),
      };
      return { transcript, tally: step.value, records, spawns, claimed };
    }
    const event = strictEvent(step.value);
    if ("rejected" in event) return event;
    if (event.kind === "spawn") {
      spawns.push(event);
      continue;
    }
    events.push(event);
    if (event.kind === "meta") continue;
    if (event.uuid === undefined) records += 1;
    else if (!uuids.has(event.uuid)) {
      uuids.add(event.uuid);
      records += 1;
    }
  }
}

function sumTallies(tallies: readonly ReaderTally[]): ReaderTally {
  const versions = new Set<string>();
  const total = { linesRead: 0, linesNotUnderstood: 0, assistantRecords: 0 };
  let assistantMissingRequired = 0;
  for (const tally of tallies) {
    total.linesRead += tally.linesRead;
    total.linesNotUnderstood += tally.linesNotUnderstood;
    total.assistantRecords += tally.assistantRecords;
    assistantMissingRequired += tally.assistantMissingRequired;
    for (const version of tally.versions) versions.add(version);
  }
  return { ...total, assistantMissingRequired, versions: [...versions].sort(compareVersions) };
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0 && !Number.isNaN(diff)) return diff;
  }
  return a.localeCompare(b);
}

async function gatesOf(ports: AuditPorts, top: string): Promise<readonly string[]> {
  const text = await ports.store.readSmall(join(top, ".mktrue.json"));
  if (text === undefined) return DEFAULT_GATES;
  try {
    const raw = JSON.parse(text) as { gates?: unknown };
    const gates = mktrueConfigSchema.shape.gates.safeParse(raw.gates);
    return gates.success && gates.data !== undefined && gates.data.length > 0
      ? gates.data
      : DEFAULT_GATES;
  } catch {
    return DEFAULT_GATES;
  }
}

function shownTarget(
  ports: AuditPorts,
  target: string,
  typed: string | undefined,
  trees: readonly AuditTree[],
): string {
  if (typed !== undefined) return printable(typed);
  let holder: AuditTree | undefined;
  for (const tree of trees) {
    if (
      isInsideTree(target, tree.path) &&
      (holder === undefined || tree.path.length > holder.path.length)
    ) {
      holder = tree;
    }
  }
  if (holder !== undefined && isInsideTree(ports.cwd, holder.path)) {
    return printable(relative(ports.cwd, target));
  }
  return `${DEFAULT_TARGET_DIR}/${basename(target)}`;
}

async function refuseDefaultLink(
  ports: AuditPorts,
  out: Output,
  target: string,
): Promise<ExitCode | undefined> {
  const checks = [
    { path: dirname(target), allowed: "dir", word: "directory", shown: DEFAULT_TARGET_DIR },
    {
      path: target,
      allowed: "file",
      word: "file",
      shown: `${DEFAULT_TARGET_DIR}/${basename(target)}`,
    },
  ] as const;
  for (const { path, allowed, word, shown } of checks) {
    const kind = await ports.targetKind(path);
    if (kind === "missing" || kind === allowed) continue;
    return refuse(
      out,
      "environment",
      `the report path is a link, or not a ${word}`,
      "audit follows no link, not even one inside .git",
      `remove ${shown}`,
      EXIT.ENVIRONMENT,
    );
  }
  return undefined;
}

function refuseEvent(out: Output, { rejected }: Rejected): ExitCode {
  const keys = rejected.keys.map(printable).join(", ") || "none named";
  const what = `an event outside its schema · ${printable(rejected.kind)} · ${keys}`;
  return refuse(
    out,
    "internal",
    clip(what, columns() - "mktrue: ✗ internal · ".length),
    "a field outside the schema could carry transcript content into the report",
    "report it with the command you ran; nothing was written",
    EXIT.ENVIRONMENT,
  );
}

export async function runAudit(
  ports: AuditPorts,
  out: Output,
  options: AuditOptions,
): Promise<ExitCode> {
  if (options.out !== undefined && options.json) {
    return refuse(
      out,
      "usage",
      "audit takes --out <file> or --json, not both",
      "--json prints the report and writes no file",
      "mktrue audit --json, or mktrue audit --out report.html",
      EXIT.USAGE,
    );
  }

  const commonDir = await ports.runner.probe([
    "git",
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  const top = await ports.runner.probe(["git", "rev-parse", "--show-toplevel"]);
  if (commonDir === undefined || top === undefined) {
    return refuse(
      out,
      "usage",
      "audit runs inside a git repository",
      "it reads the transcripts of one repository and its worktrees",
      "cd into the repository, then run mktrue audit",
      EXIT.USAGE,
    );
  }

  const trees = await findTrees(ports, top);
  const gates = await gatesOf(ports, top);
  const projects = join(ports.configDir(), "projects");
  const root = await ports.store.realPath(projects);
  const dirs = root === undefined ? [] : await findProjectDirs(ports.store, projects, trees);
  if (root === undefined || dirs.length === 0) {
    return refuse(
      out,
      "environment",
      "no Claude Code transcripts for this repository",
      "audit reads only the project dirs Claude Code wrote for this repository",
      "run Claude Code in this repository first, or set CLAUDE_CONFIG_DIR",
      EXIT.ENVIRONMENT,
    );
  }

  const walk: Walk = { store: ports.store, root, outsideRoot: 0, unreadable: 0 };
  const scan: Scan = { trees, gates, common: commonDir };
  const reads: Read[] = [];
  let dirsRead = 0;
  for (const dir of dirs) {
    const path = join(projects, dir);
    const entries = await list(walk, path);
    if (entries === undefined) continue;
    dirsRead += 1;
    const claims = new Map<string, Map<string, SpawnEvent>>();
    for (const file of await transcriptFiles(walk, path, entries)) {
      const session = claims.get(file.sessionId) ?? new Map<string, SpawnEvent>();
      const read = await readTranscript(walk, file, scan, session);
      if (read !== undefined && "rejected" in read) return refuseEvent(out, read);
      if (read === undefined) continue;
      reads.push(read);
      if (file.agentId !== undefined) continue;
      for (const spawn of read.spawns) session.set(spawn.toolUseId, spawn);
      claims.set(file.sessionId, session);
    }
  }

  const tally = sumTallies(reads.map((r) => r.tally));
  if (shapeCheckTrips(tally)) {
    const version = printable(tally.versions.at(-1) ?? "unknown").slice(0, 20);
    return refuse(
      out,
      "audit",
      "transcripts are in a shape this reader does not know",
      `Claude Code ${version} changed its transcript format; the numbers would be wrong`,
      "update mktrue, or report the version",
      EXIT.ENVIRONMENT,
    );
  }

  const recordsKept = reads.reduce((total, r) => total + r.records, 0);
  if (recordsKept === 0) {
    return refuse(
      out,
      "environment",
      "no transcript record belongs to this repository",
      "every record read was made in another directory, so there is nothing to measure",
      "run Claude Code in this repository first",
      EXIT.ENVIRONMENT,
    );
  }

  const report = auditReportSchema.parse(
    withoutC1(
      auditMetrics(
        reads.map((r) => r.transcript),
        trees,
        gates,
        {
          date: ports.today(),
          scope: {
            dirsRead,
            filesRead: reads.length,
            linesRead: tally.linesRead,
            recordsKept,
            keptByClaim: reads.filter((r) => r.claimed).length,
            outsideRootSkipped: walk.outsideRoot,
            unreadable: walk.unreadable,
          },
          reader: {
            id: READER_ID,
            testedFrom: TESTED_FROM,
            testedTo: TESTED_TO,
            linesNotUnderstood: tally.linesNotUnderstood,
            versionsSeen: tally.versions,
          },
        },
      ),
    ),
  );

  if (options.json) {
    out.line(JSON.stringify(report));
    return EXIT.TRUE;
  }

  const target =
    options.out === undefined
      ? join(commonDir, "mktrue", `audit-${report.date}.html`)
      : resolve(ports.cwd, options.out);
  if (options.out === undefined) {
    const refused = await refuseDefaultLink(ports, out, target);
    if (refused !== undefined) return refused;
  }
  const existing = options.out === undefined ? "missing" : await ports.targetKind(target);
  if (existing === "other" || existing === "dir") {
    return refuse(
      out,
      "usage",
      "--out names a link or a directory",
      "audit writes a new file, or replaces a regular one, and follows no link",
      "pass --out <file> naming a regular file or a new one",
      EXIT.USAGE,
    );
  }
  try {
    await ports.write(target, renderAuditHtml(report));
  } catch (error) {
    return refuse(
      out,
      "environment",
      `the report could not be written: ${errorCode(error)}`,
      "the numbers live in the report; without it there is nothing to read",
      "pass --out <file> somewhere writable",
      EXIT.ENVIRONMENT,
    );
  }

  const { scope, totals } = report;
  const lines = [
    `mktrue: records · ${scope.recordsKept} kept · ${scope.dirsRead} dirs read · ${scope.filesRead} files`,
    `mktrue: agents · ${totals.agents} subagents · ${totals.slices} slices`,
    `mktrue: final context · ${totals.finalContextSum} tokens · summed over subagents`,
    `mktrue: resumes · ${totals.resumes}`,
    `mktrue: re-reads · ${totals.reReads} · ${report.reReads.characters} characters`,
    `mktrue: gate runs · ${totals.gateRuns}`,
  ];
  if (report.reader.linesNotUnderstood > 0) {
    lines.push(
      `mktrue: read with ${READER_ID}, tested to ${TESTED_TO} · ${report.reader.linesNotUnderstood} lines not understood`,
    );
  }
  if (scope.unreadable > 0) {
    lines.push(`mktrue: unreadable · ${scope.unreadable} dirs and files could not be read`);
  }
  const shown = shownTarget(ports, target, options.out, trees);
  lines.push(`mktrue: report · ${shown}${existing === "file" ? " · replaced a file" : ""}`);
  for (const line of lines) out.line(clip(line, columns()));
  return EXIT.TRUE;
}
