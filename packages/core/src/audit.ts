import {
  AUDIT_BUCKETS,
  SUBAGENT_ONLY,
  type AuditEvent,
  type AuditReport,
  type AuditUsage,
  type Processed,
} from "@mktrue/contracts";

export const DEFAULT_GATES: readonly string[] = [
  "pnpm install --frozen-lockfile",
  "pnpm build",
  "pnpm check",
  "pnpm typecheck",
  "pnpm test",
  "pnpm format:check",
];

const NO_ROLE = "(no role)";
const LEAD = "lead";
const NO_SLICE = "(no slice)";
export const OUTSIDE_REPOSITORY = "outside the repository";

const SYNTHETIC_MODEL = "<synthetic>";
const INHERIT = "inherit";
export const RUNS_PER_SLICE = 4;
const GENERAL_PURPOSE = "general-purpose";
const BUCKET_UPPER_BOUNDS = [20_000, 50_000, 100_000, 150_000, 200_000];
const TOP_RE_READS = 10;
export const RE_READS_PER_SLICE = 5;

export interface AuditTree {
  readonly path: string;
  /** `.` for the repository root, the worktree's name otherwise. */
  readonly name: string;
}

export interface AuditTranscript {
  readonly sessionId: string;
  /** Present for a subagent's file, absent for a main session's. */
  readonly agentId?: string;
  readonly events: readonly AuditEvent[];
  /** The file's earliest call fell outside the window, so its first kept call is mid-run. */
  readonly startedBefore?: boolean;
}

/** Absolute instants in milliseconds, half-open: `since` is in, `until` is out. */
export interface AuditWindow {
  readonly since?: number;
  readonly until?: number;
}

export interface AuditMerged {
  readonly base: string;
  /** Committer times, in milliseconds, of the base branch's first-parent commits. */
  readonly committed: readonly number[];
}

/** A bench role, as much of it as the slice shape is measured against. */
export interface AuditRole {
  readonly id: string;
  readonly model?: string | undefined;
  readonly runsPerSlice?: number | undefined;
}

export interface AuditRun {
  readonly date: string;
  readonly roles: readonly AuditRole[];
  readonly scope: AuditReport["scope"];
  readonly reader: AuditReport["reader"];
  readonly window?: AuditWindow;
  /** Absent when git could not name the base branch's commits. */
  readonly merged?: AuditMerged;
  /** `budgets.fixedReading`, in tokens; absent, no run is measured against it. */
  readonly fixedReadingBudget?: number;
}

export function isInWindow(time: number | undefined, window: AuditWindow): boolean {
  if (window.since === undefined && window.until === undefined) return true;
  if (time === undefined) return false;
  return (
    (window.since === undefined || time >= window.since) &&
    (window.until === undefined || time < window.until)
  );
}

/** A model call that was billed: an assistant record with usage, not a synthetic one. */
export function isCall(
  event: AuditEvent,
): event is Extract<AuditEvent, { kind: "assistant" }> & { usage: object } {
  return event.kind === "assistant" && event.usage !== undefined && event.model !== SYNTHETIC_MODEL;
}

export function eventInWindow(event: AuditEvent, window: AuditWindow): boolean {
  return event.kind === "meta" || isInWindow(timeOf(event.timestamp), window);
}

const SEGMENT_BREAK = /&&|\|\||[;|&\n()]/;
const PACKAGE_FLAGS = new Set(["--filter", "-F", "-C", "--dir"]);
const PACKAGE_NAME = /^[A-Za-z0-9@._][A-Za-z0-9@._/-]{0,99}$/;

function packageName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const name = value
    .replace(/^(['"])(.*)\1$/, "$2")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
  return PACKAGE_NAME.test(name) && !name.split("/").includes("..") ? name : undefined;
}

function isVitestRun(words: readonly string[], at: number): boolean {
  return words[at] === "vitest" && words[at + 1] === "run";
}

function testRunAt(words: readonly string[], at: number): { package?: string } | undefined {
  const runner = words[at];
  let named: string | undefined;
  let i = at + 1;
  while (words[i]?.startsWith("-") === true) {
    const flag = words[i]!;
    const [option, inline] = flag.split("=", 2) as [string, string | undefined];
    if (runner === "pnpm" && PACKAGE_FLAGS.has(option)) {
      named ??= inline ?? words[i + 1];
      i += inline === undefined ? 2 : 1;
    } else {
      i += 1;
    }
  }
  const found =
    runner === "npx"
      ? isVitestRun(words, i)
      : words[i] === "test" ||
        (words[i] === "run" && words[i + 1] === "test") ||
        isVitestRun(words, i) ||
        (words[i] === "exec" && isVitestRun(words, i + 1));
  if (!found) return undefined;
  const name = packageName(named);
  return name === undefined ? {} : { package: name };
}

/** One shell command is one test run at most; the package is the first one it names. */
export function testRunOf(command: string): { package?: string } | undefined {
  let found: { package?: string } | undefined;
  for (const segment of command.split(SEGMENT_BREAK)) {
    const words = segment.trim().split(/\s+/);
    for (const [at, word] of words.entries()) {
      if (word !== "pnpm" && word !== "npx") continue;
      const run = testRunAt(words, at);
      if (run === undefined) continue;
      if (run.package !== undefined) return run;
      found ??= run;
    }
  }
  return found;
}

export function mergedInWindow(committed: readonly number[], window: AuditWindow): number {
  return committed.filter((time) => isInWindow(time, window)).length;
}

interface Call {
  readonly context: number;
  readonly usage: AuditUsage;
  readonly model: string | undefined;
  readonly timestamp: number | undefined;
}

interface Work {
  readonly calls: readonly Call[];
  readonly processed: Processed;
  readonly finalContext: number;
  readonly reReads: number;
  readonly reReadCharacters: number;
  readonly reReadPaths: ReadonlyMap<string, number>;
  readonly gateRuns: ReadonlyMap<string, number>;
  /** One entry per test run: the package it names, or undefined. */
  readonly testRuns: readonly (string | undefined)[];
}

const ZERO: Processed = { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 };

function addProcessed(a: Processed, b: Processed): Processed {
  return {
    uncachedInput: a.uncachedInput + b.uncachedInput,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
  };
}

function contextOf(usage: AuditUsage): number {
  return usage.input + usage.cacheRead + usage.cacheCreation;
}

function finalContextOf(calls: readonly Call[]): number {
  const last = calls.at(-1);
  return last === undefined ? 0 : last.context + last.usage.output;
}

function timeOf(timestamp: string | undefined): number | undefined {
  if (timestamp === undefined) return undefined;
  const time = Date.parse(timestamp);
  return Number.isNaN(time) ? undefined : time;
}

function isInside(path: string, tree: string): boolean {
  return path === tree || path.startsWith(tree.endsWith("/") ? tree : `${tree}/`);
}

function treeOf(path: string, trees: readonly AuditTree[]): AuditTree | undefined {
  let found: AuditTree | undefined;
  for (const tree of trees) {
    if (
      isInside(path, tree.path) &&
      (found === undefined || tree.path.length > found.path.length)
    ) {
      found = tree;
    }
  }
  return found;
}

function normalise(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

/** A path as the report may show it: relative to its tree, or the outside label. */
export function repoRelative(path: string, trees: readonly AuditTree[]): string {
  if (!path.startsWith("/")) return OUTSIDE_REPOSITORY;
  const absolute = normalise(path);
  const tree = treeOf(absolute, trees);
  if (tree === undefined) return OUTSIDE_REPOSITORY;
  const rest = absolute.slice(normalise(tree.path).length).replace(/^\//, "");
  return rest === "" ? "." : rest;
}

function workOf(events: readonly AuditEvent[], trees: readonly AuditTree[]): Work {
  const calls: Call[] = [];
  let processed = ZERO;
  const readPaths = new Map<string, string>();
  const resultLengths = new Map<string, number>();
  const gateRuns = new Map<string, number>();
  const testRuns: (string | undefined)[] = [];

  for (const event of events) {
    if (event.kind === "assistant") {
      if (!isCall(event)) continue;
      calls.push({
        context: contextOf(event.usage),
        usage: event.usage,
        model: event.model,
        timestamp: timeOf(event.timestamp),
      });
      processed = addProcessed(processed, {
        uncachedInput: event.usage.input,
        cacheRead: event.usage.cacheRead,
        cacheWrite: event.usage.cacheCreation,
        output: event.usage.output,
      });
    } else if (event.kind === "tool_use") {
      if (event.name === "Read" && event.filePath !== undefined) {
        readPaths.set(event.toolUseId ?? `read-${readPaths.size}`, event.filePath);
      }
      for (const gate of event.gates ?? []) gateRuns.set(gate, (gateRuns.get(gate) ?? 0) + 1);
      if (event.testRun !== undefined) testRuns.push(event.testRun.package);
    } else if (event.kind === "tool_result" && event.toolUseId !== undefined) {
      resultLengths.set(event.toolUseId, (resultLengths.get(event.toolUseId) ?? 0) + event.length);
    }
  }

  const seen = new Set<string>();
  const reReadPaths = new Map<string, number>();
  let reReads = 0;
  let reReadCharacters = 0;
  for (const [toolUseId, path] of readPaths) {
    const label = repoRelative(path, trees);
    const key = label === OUTSIDE_REPOSITORY ? path : label;
    if (!seen.has(key)) {
      seen.add(key);
      continue;
    }
    reReads += 1;
    reReadCharacters += resultLengths.get(toolUseId) ?? 0;
    reReadPaths.set(label, (reReadPaths.get(label) ?? 0) + 1);
  }

  return {
    calls,
    processed,
    finalContext: finalContextOf(calls),
    reReads,
    reReadCharacters,
    reReadPaths,
    gateRuns,
    testRuns,
  };
}

function distribution(values: readonly number[]): AuditReport["fixedReading"]["lead"] {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (q: number) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] ?? null;
  return { count: sorted.length, median: rank(0.5), p90: rank(0.9), max: sorted.at(-1) ?? null };
}

function bucketOf(context: number): number {
  const index = BUCKET_UPPER_BOUNDS.findIndex((bound) => context < bound);
  return index === -1 ? BUCKET_UPPER_BOUNDS.length : index;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function largest(values: readonly number[]): number {
  let found = -Infinity;
  for (const value of values) if (value > found) found = value;
  return found;
}

function smallest(values: readonly number[]): number {
  let found = Infinity;
  for (const value of values) if (value < found) found = value;
  return found;
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/** `opus` is any `claude-opus-*`; a full id is itself; `inherit` and an unknown run never differ. */
export function modelDiffers(expected: string | undefined, model: string | null): boolean {
  if (expected === undefined || expected === INHERIT || model === null) return false;
  return expected.includes("-") ? model !== expected : !model.startsWith(`claude-${expected}-`);
}

export function sliceBound(
  roles: readonly string[],
  registered: ReadonlyMap<string, AuditRole>,
): number {
  let bound = RUNS_PER_SLICE;
  for (const role of roles) bound = Math.max(bound, registered.get(role)?.runsPerSlice ?? 0);
  return bound;
}

function shapeOf(
  agents: AuditReport["agents"],
  slices: AuditReport["slices"],
  registered: ReadonlyMap<string, AuditRole>,
): Omit<AuditReport["shape"], "overReads"> {
  const noRole = agents.filter((a) => a.statedRole === null).length;
  const invented = new Map<string, number>();
  for (const { statedRole } of agents) {
    if (statedRole !== null && !registered.has(statedRole)) {
      invented.set(statedRole, (invented.get(statedRole) ?? 0) + 1);
    }
  }
  const modelMismatches = agents.flatMap((a) => {
    const expected = registered.get(a.role)?.model;
    return a.model !== null && expected !== undefined && modelDiffers(expected, a.model)
      ? [{ agentId: a.agentId, slice: a.slice, role: a.role, expected, model: a.model }]
      : [];
  });
  const overBound = slices.flatMap((s) =>
    s.slice !== null && s.bound !== null && s.agents > s.bound
      ? [{ slice: s.slice, runs: s.agents, bound: s.bound }]
      : [],
  );
  return {
    runs: agents.length,
    noRole,
    noRolePercent: agents.length === 0 ? null : Math.round((100 * noRole) / agents.length),
    invented: [...invented]
      .sort(([ra, a], [rb, b]) => b - a || compareText(ra, rb))
      .map(([role, runs]) => ({ role, runs })),
    modelMismatches,
    overBound,
  };
}

function spawnKey(sessionId: string, toolUseId: string): string {
  return `${sessionId}\n${toolUseId}`;
}

type EnvelopeEvent = Exclude<AuditEvent, { kind: "meta" }>;

function withEnvelope(events: readonly AuditEvent[]): EnvelopeEvent[] {
  return events.filter((event): event is EnvelopeEvent => event.kind !== "meta");
}

function eventTimes(events: readonly AuditEvent[]): number[] {
  return withEnvelope(events).flatMap((event) => {
    const time = timeOf(event.timestamp);
    return time === undefined ? [] : [time];
  });
}

export function auditMetrics(
  transcripts: readonly AuditTranscript[],
  trees: readonly AuditTree[],
  gates: readonly string[],
  run: AuditRun,
): AuditReport {
  const registered = new Map(run.roles.map((role) => [role.id, role]));
  const kept = transcripts.filter((t) => t.events.some((event) => event.kind !== "meta"));
  const leadFiles = kept.filter((t) => t.agentId === undefined);
  const agentFiles = kept.filter((t) => t.agentId !== undefined);
  const work = new Map(kept.map((t) => [t, workOf(t.events, trees)]));
  const workOfFile = (t: AuditTranscript): Work => work.get(t)!;

  const spawns = new Map<string, Extract<AuditEvent, { kind: "tool_use" }>>();
  const notifications = new Map<string, Extract<AuditEvent, { kind: "task_notification" }>>();
  const resumeTimes = new Map<string, (number | undefined)[]>();
  for (const t of kept) {
    for (const event of t.events) {
      if (event.kind === "tool_use" && event.name === "Agent" && event.toolUseId !== undefined) {
        spawns.set(spawnKey(t.sessionId, event.toolUseId), event);
      } else if (event.kind === "task_notification" && event.taskAgentId !== undefined) {
        notifications.set(event.taskAgentId, event);
      } else if (event.kind === "tool_result" && event.resumedAgentId !== undefined) {
        const times = resumeTimes.get(event.resumedAgentId) ?? [];
        times.push(timeOf(event.timestamp));
        resumeTimes.set(event.resumedAgentId, times);
      }
    }
  }

  const leads: AuditReport["leads"] = leadFiles.map((t) => {
    const w = workOfFile(t);
    const records = withEnvelope(t.events);
    const cwd = records.find((e) => e.cwd !== undefined)?.cwd;
    return {
      sessionId: t.sessionId,
      branch: records.find((e) => e.gitBranch !== undefined)?.gitBranch ?? null,
      tree: (cwd === undefined ? undefined : treeOf(cwd, trees)?.name) ?? ".",
      calls: w.calls.length,
      finalContext: w.finalContext,
      processed: w.processed,
    };
  });

  const agents: AuditReport["agents"] = agentFiles.map((t) => {
    const w = workOfFile(t);
    const meta = t.events.find((e) => e.kind === "meta");
    const spawn =
      meta?.kind === "meta" && meta.toolUseId !== undefined
        ? spawns.get(spawnKey(t.sessionId, meta.toolUseId))
        : undefined;
    const agentType = meta?.kind === "meta" ? meta.agentType : undefined;
    const statedRole = spawn?.statedRole ?? null;
    const role =
      statedRole ??
      (agentType !== undefined && agentType !== GENERAL_PURPOSE
        ? agentType
        : (spawn?.role ?? NO_ROLE));
    const notification = notifications.get(t.agentId!);
    const times = eventTimes(t.events);
    return {
      agentId: t.agentId!,
      sessionId: t.sessionId,
      slice: spawn?.slice ?? null,
      role,
      statedRole,
      model: w.calls.at(-1)?.model ?? null,
      calls: w.calls.length,
      finalContext: w.finalContext,
      subagentTokens: notification?.subagentTokens ?? null,
      processed: w.processed,
      durationMs: times.length === 0 ? null : largest(times) - smallest(times),
      reportChars: notification?.resultLength ?? null,
    };
  });

  const callsOfAgent = new Map(agentFiles.map((t) => [t.agentId!, workOfFile(t).calls]));
  const resumed: AuditReport["resumed"] = [...resumeTimes]
    .sort(([a], [b]) => compareText(a, b))
    .map(([agentId, times]) => {
      const calls = callsOfAgent.get(agentId) ?? [];
      const known = times.filter((time): time is number => time !== undefined);
      const first = known.length === 0 ? undefined : smallest(known);
      const before = calls.filter(
        (c) => first === undefined || c.timestamp === undefined || c.timestamp < first,
      );
      const after = calls.slice(before.length);
      return {
        agentId,
        resumes: times.length,
        before: { calls: before.length, finalContext: finalContextOf(before) },
        after: { calls: after.length, finalContext: finalContextOf(after) },
      };
    });
  const resumesOf = new Map(resumed.map((r) => [r.agentId, r.resumes]));

  const histogram = AUDIT_BUCKETS.map((bucket) => ({ bucket, lead: 0, subagents: 0 }));
  for (const t of kept) {
    const side = t.agentId === undefined ? "lead" : "subagents";
    for (const call of workOfFile(t).calls) histogram[bucketOf(call.context)]![side] += 1;
  }

  const firstCallOf = (t: AuditTranscript) =>
    t.startedBefore === true ? undefined : workOfFile(t).calls[0];
  const startedBefore = kept.filter(
    (t) => t.startedBefore === true && workOfFile(t).calls.length > 0,
  ).length;

  const firstContexts = (files: readonly AuditTranscript[]) =>
    files.flatMap((t) => {
      const first = firstCallOf(t);
      return first === undefined ? [] : [first.context];
    });

  const runsOverFloor = (budget: number) =>
    [
      ...leadFiles.map((t) => ({ t, run: t.sessionId, role: LEAD })),
      ...agentFiles.map((t, i) => ({ t, run: t.agentId!, role: agents[i]!.role })),
    ]
      .flatMap(({ t, run, role }) => {
        const first = firstCallOf(t);
        return first === undefined || first.context <= budget
          ? []
          : [{ run, role, tokens: first.context }];
      })
      .sort((a, b) => b.tokens - a.tokens || compareText(a.run, b.run));

  const topPaths = new Map<string, number>();
  for (const w of work.values()) {
    for (const [path, count] of w.reReadPaths)
      topPaths.set(path, (topPaths.get(path) ?? 0) + count);
  }
  const top = [...topPaths]
    .sort(([pa, a], [pb, b]) => b - a || compareText(pa, pb))
    .slice(0, TOP_RE_READS)
    .map(([path, reReads]) => ({ path, reReads }));

  const gateRuns = gates.map((gate) => ({
    gate,
    runs: sum([...work.values()].map((w) => w.gateRuns.get(gate) ?? 0)),
  }));

  const sliceNames = [...new Set(agents.map((a) => a.slice))].sort((a, b) =>
    a === null ? 1 : b === null ? -1 : compareText(a, b),
  );
  const slices: AuditReport["slices"] = sliceNames.map((slice) => {
    const members = agentFiles.filter((_, i) => agents[i]!.slice === slice);
    const rows = agents.filter((a) => a.slice === slice);
    const memberWork = members.map(workOfFile);
    return {
      slice,
      agents: rows.length,
      calls: sum(rows.map((a) => a.calls)),
      finalContextSum: sum(rows.map((a) => a.finalContext)),
      processed: rows.reduce((total, a) => addProcessed(total, a.processed), ZERO),
      reReads: sum(memberWork.map((w) => w.reReads)),
      gateRuns: sum(memberWork.flatMap((w) => gates.map((gate) => w.gateRuns.get(gate) ?? 0))),
      resumes: sum(rows.map((a) => resumesOf.get(a.agentId) ?? 0)),
      bound:
        slice === null
          ? null
          : sliceBound(
              rows.map((a) => a.role),
              registered,
            ),
    };
  });

  const overReads: AuditReport["shape"]["overReads"] = [];
  for (const slice of sliceNames) {
    if (slice === null) continue;
    const perPath = new Map<string, number>();
    agentFiles.forEach((t, i) => {
      if (agents[i]!.slice !== slice) return;
      for (const [path, count] of workOfFile(t).reReadPaths) {
        if (path !== OUTSIDE_REPOSITORY) perPath.set(path, (perPath.get(path) ?? 0) + count);
      }
    });
    for (const [path, reReads] of [...perPath].sort(
      ([pa, a], [pb, b]) => b - a || compareText(pa, pb),
    )) {
      if (reReads > RE_READS_PER_SLICE) overReads.push({ slice, path, reReads });
    }
  }

  const allWork = [...work.values()];
  const processed = allWork.reduce((total, w) => addProcessed(total, w.processed), ZERO);
  const processedTokens =
    processed.uncachedInput + processed.cacheRead + processed.cacheWrite + processed.output;
  const window = run.window ?? {};
  const instant = (time: number | undefined) =>
    time === undefined ? null : new Date(time).toISOString();
  const runs = allWork.flatMap((w) => w.testRuns);
  const perPackage = new Map<string, number>();
  for (const name of runs) {
    if (name !== undefined) perPackage.set(name, (perPackage.get(name) ?? 0) + 1);
  }
  const pullRequests = run.merged === undefined ? 0 : mergedInWindow(run.merged.committed, window);
  return {
    schema: 4,
    date: run.date,
    window: { since: instant(window.since), until: instant(window.until) },
    subagentOnly: [...SUBAGENT_ONLY],
    reader: run.reader,
    scope: run.scope,
    gates: [...gates],
    histogram,
    fixedReading: {
      lead: distribution(firstContexts(leadFiles)),
      subagents: distribution(firstContexts(agentFiles)),
      ...(startedBefore === 0 ? {} : { startedBefore }),
      ...(run.fixedReadingBudget === undefined
        ? {}
        : { budget: run.fixedReadingBudget, over: runsOverFloor(run.fixedReadingBudget) }),
    },
    reReads: {
      count: sum(allWork.map((w) => w.reReads)),
      characters: sum(allWork.map((w) => w.reReadCharacters)),
      top,
    },
    leads,
    agents,
    resumed,
    gateRuns,
    testRuns: {
      runs: runs.length,
      packages: [...perPackage]
        .sort(([pa, a], [pb, b]) => b - a || compareText(pa, pb))
        .map(([name, count]) => ({ package: name, runs: count })),
    },
    merged:
      run.merged === undefined
        ? null
        : {
            base: run.merged.base,
            pullRequests,
            processedPerPullRequest:
              pullRequests === 0 ? null : Math.round(processedTokens / pullRequests),
          },
    slices,
    shape: { ...shapeOf(agents, slices, registered), overReads },
    totals: {
      agents: agents.length,
      slices: slices.length,
      calls: sum(allWork.map((w) => w.calls.length)),
      finalContextSum: sum(agents.map((a) => a.finalContext)),
      resumes: sum(resumed.map((r) => r.resumes)),
      reReads: sum(allWork.map((w) => w.reReads)),
      gateRuns: sum(gateRuns.map((g) => g.runs)),
      processed,
      processedTokens,
    },
  };
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);
}

type Cell = string | number | null;

function cell(value: Cell): string {
  return value === null ? "–" : escapeHtml(String(value));
}

function table(headers: readonly string[], rows: readonly (readonly Cell[])[]): string {
  if (rows.length === 0) return "<p>None.</p>";
  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const body = rows
    .map((row) => `<tr>${row.map((value) => `<td>${cell(value)}</td>`).join("")}</tr>`)
    .join("\n");
  return `<table><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table>`;
}

function definitions(facts: readonly (readonly [string, Cell])[]): string {
  return `<dl>${facts.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${cell(v)}</dd>`).join("")}</dl>`;
}

function section(title: string, note: string, content: string): string {
  return `<section><h2>${escapeHtml(title)}</h2><p class="note">${escapeHtml(note)}</p>\n${content}</section>`;
}

const PROCESSED_HEADERS = [
  "uncached input (tokens)",
  "cache read (tokens)",
  "cache write (tokens)",
  "output (tokens)",
];

function processedCells(p: Processed): Cell[] {
  return [p.uncachedInput, p.cacheRead, p.cacheWrite, p.output];
}

function seconds(ms: number | null): Cell {
  return ms === null ? null : Math.round(ms / 1000);
}

const STYLE = `
:root { color-scheme: light dark; --fg: #1b1b1b; --bg: #fbfaf7; --muted: #666; --rule: #ddd; --accent: #b86e00; }
@media (prefers-color-scheme: dark) { :root { --fg: #e8e6e1; --bg: #161616; --muted: #9a9a9a; --rule: #333; --accent: #f5a300; } }
body { margin: 0 auto; max-width: 72rem; padding: 2rem 1rem; font: 15px/1.5 system-ui, sans-serif; color: var(--fg); background: var(--bg); }
h1 { font-size: 1.5rem; margin: 0 0 .25rem; } h1 span { color: var(--accent); }
h2 { font-size: 1.1rem; margin: 2rem 0 .25rem; }
.note { color: var(--muted); margin: 0 0 .75rem; }
section { overflow-x: auto; }
table { border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { padding: .25rem .75rem .25rem 0; border-bottom: 1px solid var(--rule); text-align: left; vertical-align: top; }
td { white-space: nowrap; }
dl { display: grid; grid-template-columns: max-content auto; gap: .1rem 1rem; margin: 0; }
dt { color: var(--muted); } dd { margin: 0; }
`;

export function renderAuditHtml(report: AuditReport): string {
  const { reader, scope, totals } = report;
  const facts: [string, Cell][] = [
    ["project dirs read (dirs)", scope.dirsRead],
    ["transcript files read (files)", scope.filesRead],
    ["lines read (lines)", scope.linesRead],
    ["records kept (records)", scope.recordsKept],
    ["subagents kept by the slice path in their spawning prompt (agents)", scope.keptByClaim],
    ["links out of the projects root, skipped (entries)", scope.outsideRootSkipped],
    ["dirs and files that could not be read (entries)", scope.unreadable],
    ["reader", `${reader.id}, tested ${reader.testedFrom} to ${reader.testedTo}`],
    ["lines not understood (lines)", reader.linesNotUnderstood],
    ["Claude Code versions seen", reader.versionsSeen.join(", ") || null],
  ];
  const dl = definitions(facts);
  const { window, testRuns, merged } = report;
  const measured = definitions([
    ["since, inclusive (instant)", window.since],
    ["until, exclusive (instant)", window.until],
    ["processed by the lead and subagents, the four parts added (tokens)", totals.processedTokens],
    ["test runs, one per shell command (runs)", testRuns.runs],
    ["base branch (ref)", merged?.base ?? "not read"],
    [
      "merged pull requests, first-parent commits in the window (commits)",
      merged?.pullRequests ?? null,
    ],
    ["processed per merged pull request (tokens)", merged?.processedPerPullRequest ?? null],
  ]);

  const parts: string[] = [
    section(
      "Scope",
      "What was read and kept. Records outside this repository and its worktrees are dropped before any figure is computed.",
      dl,
    ),
    section(
      "Totals",
      "Final context is a subagent's last call's context plus its output, summed over subagents. It is not the processed figure.",
      table(
        [
          "subagents (agents)",
          "slices (slices)",
          "API calls (calls)",
          "final context, summed (tokens)",
          "resumes (resumes)",
          "re-reads (reads)",
          "gate runs (runs)",
        ],
        [
          [
            totals.agents,
            totals.slices,
            totals.calls,
            totals.finalContextSum,
            totals.resumes,
            totals.reReads,
            totals.gateRuns,
          ],
        ],
      ),
    ),
    section(
      "Window and merged pull requests",
      "Records outside the window are dropped before any figure is computed. A merged pull request is a first-parent commit on the base branch.",
      measured,
    ),
    section(
      "Test runs per package",
      "A test run is a shell command that runs the tests; the package is the one it names.",
      table(
        ["package", "test runs (runs)"],
        testRuns.packages.map((row) => [row.package, row.runs]),
      ),
    ),
    section(
      "Calls by context size",
      "A call's context is its input, cache read and cache creation tokens.",
      table(
        ["context (tokens)", "lead calls (calls)", "subagent calls (calls)"],
        report.histogram.map((row) => [row.bucket, row.lead, row.subagents]),
      ),
    ),
    section(
      "Fixed reading per turn",
      "The context of each session's and each subagent's first call.",
      table(
        ["who", "first calls (calls)", "median (tokens)", "p90 (tokens)", "max (tokens)"],
        (["lead", "subagents"] as const).map((who) => {
          const d = report.fixedReading[who];
          return [who, d.count, d.median, d.p90, d.max];
        }),
      ),
    ),
    section(
      "Documents re-read",
      `A Read of a path the same agent or session had already read. ${report.reReads.count} re-reads (reads) returned ${report.reReads.characters} characters.`,
      table(
        ["path", "re-reads (reads)"],
        report.reReads.top.map((row) => [row.path, row.reReads]),
      ),
    ),
    section(
      "Subagent runs",
      "Final context and processed are separate figures; the four processed parts are never added together.",
      table(
        [
          "agent",
          "slice",
          "role",
          "stated role",
          "model",
          "calls (calls)",
          "final context (tokens)",
          "subagent_tokens (tokens)",
          ...PROCESSED_HEADERS,
          "duration (s)",
          "report (characters)",
        ],
        report.agents.map((a) => [
          a.agentId,
          a.slice ?? NO_SLICE,
          a.role,
          a.statedRole,
          a.model,
          a.calls,
          a.finalContext,
          a.subagentTokens,
          ...processedCells(a.processed),
          seconds(a.durationMs),
          a.reportChars,
        ]),
      ),
    ),
    section(
      "Lead sessions",
      "The branch is a label only; it never assigns a slice.",
      table(
        [
          "session",
          "branch",
          "tree",
          "calls (calls)",
          "final context (tokens)",
          ...PROCESSED_HEADERS,
        ],
        report.leads.map((l) => [
          l.sessionId,
          l.branch,
          l.tree,
          l.calls,
          l.finalContext,
          ...processedCells(l.processed),
        ]),
      ),
    ),
    section(
      "Resumed agents",
      "Calls and final context before and after each agent's first resume.",
      table(
        [
          "agent",
          "resumes (resumes)",
          "calls before (calls)",
          "final context before (tokens)",
          "calls after (calls)",
          "final context after (tokens)",
        ],
        report.resumed.map((r) => [
          r.agentId,
          r.resumes,
          r.before.calls,
          r.before.finalContext,
          r.after.calls,
          r.after.finalContext,
        ]),
      ),
    ),
    section(
      "Gate runs",
      "A chain counts as one run of each gate it contains.",
      table(
        ["gate", "runs (runs)"],
        report.gateRuns.map((g) => [g.gate, g.runs]),
      ),
    ),
    section(
      "Per slice",
      "Subagents only, grouped by the slice named in the prompt that spawned them.",
      table(
        [
          "slice",
          "agents (agents)",
          "calls (calls)",
          "final context, summed (tokens)",
          ...PROCESSED_HEADERS,
          "re-reads (reads)",
          "gate runs (runs)",
          "resumes (resumes)",
          "bound (runs)",
        ],
        report.slices.map((s) => [
          s.slice ?? NO_SLICE,
          s.agents,
          s.calls,
          s.finalContextSum,
          ...processedCells(s.processed),
          s.reReads,
          s.gateRuns,
          s.resumes,
          s.bound,
        ]),
      ),
    ),
  ];

  const { shape } = report;
  parts.push(
    section(
      "Runs with no role",
      "A run is one subagent; a resumed one is still one. A run has no role when its prompt's first line is not the loop contract's.",
      definitions([
        ["runs (runs)", shape.runs],
        ["runs with no role (runs)", shape.noRole],
        ["runs with no role, of all runs (percent)", shape.noRolePercent],
      ]),
    ),
    section(
      "Invented roles",
      "A role a first line states that the bench does not have.",
      table(
        ["role", "runs (runs)"],
        shape.invented.map((row) => [row.role, row.runs]),
      ),
    ),
    section(
      "Model mismatches",
      "A run whose last call's model is not the one its bench role sets.",
      table(
        ["agent", "slice", "role", "model", "expected model"],
        shape.modelMismatches.map((m) => [
          m.agentId,
          m.slice ?? NO_SLICE,
          m.role,
          m.model,
          m.expected,
        ]),
      ),
    ),
    section(
      "Slices over the bound",
      `A slice takes at most ${RUNS_PER_SLICE} runs, or the larger bound a role in it sets.`,
      table(
        ["slice", "runs (runs)", "bound (runs)"],
        shape.overBound.map((o) => [o.slice, o.runs, o.bound]),
      ),
    ),
    section(
      "Paths re-read past the bound",
      `A path re-read more than ${RE_READS_PER_SLICE} times in one slice, summed over its subagents.`,
      table(
        ["slice", "path", "re-reads (reads)"],
        shape.overReads.map((o) => [o.slice, o.path, o.reReads]),
      ),
    ),
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>mktrue audit ${escapeHtml(report.date)}</title>
<style>${STYLE}</style>
</head>
<body>
<h1><span>mktrue</span> audit · ${escapeHtml(report.date)}</h1>
<p class="note">Read from this machine's Claude Code transcripts. Nothing was sent anywhere.</p>
${parts.join("\n")}
</body>
</html>
`;
}
