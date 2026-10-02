import {
  AUDIT_BUCKETS,
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
const NO_SLICE = "(no slice)";
export const OUTSIDE_REPOSITORY = "outside the repository";

const SYNTHETIC_MODEL = "<synthetic>";
const GENERAL_PURPOSE = "general-purpose";
const BUCKET_UPPER_BOUNDS = [20_000, 50_000, 100_000, 150_000, 200_000];
const TOP_RE_READS = 10;

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
}

export interface AuditRun {
  readonly date: string;
  readonly scope: AuditReport["scope"];
  readonly reader: AuditReport["reader"];
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

  for (const event of events) {
    if (event.kind === "assistant") {
      if (event.usage === undefined || event.model === SYNTHETIC_MODEL) continue;
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
    const role =
      agentType !== undefined && agentType !== GENERAL_PURPOSE
        ? agentType
        : (spawn?.role ?? NO_ROLE);
    const notification = notifications.get(t.agentId!);
    const times = eventTimes(t.events);
    return {
      agentId: t.agentId!,
      sessionId: t.sessionId,
      slice: spawn?.slice ?? null,
      role,
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

  const firstContexts = (files: readonly AuditTranscript[]) =>
    files.flatMap((t) => {
      const first = workOfFile(t).calls[0];
      return first === undefined ? [] : [first.context];
    });

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
    };
  });

  const allWork = [...work.values()];
  return {
    schema: 1,
    date: run.date,
    reader: run.reader,
    scope: run.scope,
    gates: [...gates],
    histogram,
    fixedReading: {
      lead: distribution(firstContexts(leadFiles)),
      subagents: distribution(firstContexts(agentFiles)),
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
    slices,
    totals: {
      agents: agents.length,
      slices: slices.length,
      calls: sum(allWork.map((w) => w.calls.length)),
      finalContextSum: sum(agents.map((a) => a.finalContext)),
      resumes: sum(resumed.map((r) => r.resumes)),
      reReads: sum(allWork.map((w) => w.reReads)),
      gateRuns: sum(gateRuns.map((g) => g.runs)),
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
  const dl = `<dl>${facts.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${cell(v)}</dd>`).join("")}</dl>`;

  const parts = [
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
        ]),
      ),
    ),
  ];

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
