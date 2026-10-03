import type {
  AuditEvent,
  AuditUsage,
  ReaderEvent,
  ReaderTally,
  SpawnEvent,
} from "@mktrue/contracts";

export const READER_ID = "claude-code-1";
export const TESTED_FROM = "2.1.247";
export const TESTED_TO = "2.1.280";
export const SHAPE_CHECK_THRESHOLD = 0.5;

const SYNTHETIC_MODEL = "<synthetic>";

const METADATA_TYPES = new Set([
  "attachment",
  "system",
  "atis-latch",
  "last-prompt",
  "mode",
  "agent-name",
  "pr-link",
  "custom-title",
  "bridge-session",
  "permission-mode",
  "queue-operation",
  "frame-link",
  "ai-title",
  "agent-setting",
  "file-history-snapshot",
  "file-history-delta",
  "continued-in",
  "cost-state",
  "summary",
]);

const SLICE_ID = "[A-Za-z0-9][A-Za-z0-9._-]*";
const SLICE_PATTERN = new RegExp(`/slices/(${SLICE_ID})/`);
const ROLE_PATTERN = new RegExp(`/slices/${SLICE_ID}/([A-Za-z0-9_-]+)\\.md`, "g");
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const PATH_START = `(?<![^\\s"'\`(<\\[=:,])`;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

type ToolUseEvent = Extract<AuditEvent, { kind: "tool_use" }>;
type Envelope = ReturnType<typeof envelopeOf>;

function defined<T extends object>(fields: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

interface Rejects {
  count: number;
}

function idOf(value: unknown, rejects: Rejects): string | undefined {
  const text = str(value);
  if (text === undefined || ID_PATTERN.test(text)) return text;
  rejects.count += 1;
  return undefined;
}

function envelopeOf(record: Json, rejects: Rejects) {
  return defined({
    sessionId: idOf(record.sessionId, rejects),
    agentId: idOf(record.agentId, rejects),
    uuid: str(record.uuid),
    timestamp: str(record.timestamp),
    cwd: str(record.cwd),
    gitBranch: str(record.gitBranch),
    version: str(record.version),
    isSidechain: typeof record.isSidechain === "boolean" ? record.isSidechain : undefined,
  });
}

function usageOf(message: Json): AuditUsage | undefined {
  const usage = message.usage;
  if (!isObject(usage)) return undefined;
  const input = num(usage.input_tokens);
  if (input === undefined) return undefined;
  return {
    input,
    output: num(usage.output_tokens) ?? 0,
    cacheRead: num(usage.cache_read_input_tokens) ?? 0,
    cacheCreation: num(usage.cache_creation_input_tokens) ?? 0,
  };
}

function blocksOf(message: Json): Json[] {
  return Array.isArray(message.content) ? message.content.filter(isObject) : [];
}

function gatePattern(gate: string): RegExp {
  const words = gate.trim().split(/\s+/).map(escapeRegExp);
  return new RegExp(`(?<![^\\s;&|()])${words.join("\\s+")}(?![^\\s;&|()])`);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function roleOf(match: RegExpMatchArray): string | undefined {
  const name = match.at(-1);
  return name === undefined || name === "brief" ? undefined : name.replace(/-\d+$/, "");
}

function sliceAndRole(prompt: string): { slice?: string; role?: string } {
  const slice = SLICE_PATTERN.exec(prompt)?.[1];
  let role: string | undefined;
  for (const match of prompt.matchAll(ROLE_PATTERN)) {
    role = roleOf(match);
    if (role !== undefined) break;
  }
  return defined({ slice, role });
}

function claimPattern(common: string): RegExp {
  const roots = [common, ...(common.endsWith("/.git") ? [`${common.slice(0, -5)}/.mktrue`] : [])];
  const slices = `(?:${roots.map(escapeRegExp).join("|")})/slices/(${SLICE_ID})/`;
  return new RegExp(`${PATH_START}${slices}(?:([A-Za-z0-9_-]+)\\.md)?`, "g");
}

function spawnEvent(block: Json, claim: RegExp): SpawnEvent | undefined {
  if (block.type !== "tool_use" || block.name !== "Agent") return undefined;
  const toolUseId = str(block.id);
  if (toolUseId === undefined || !ID_PATTERN.test(toolUseId)) return undefined;
  const input = isObject(block.input) ? block.input : {};
  let slice: string | undefined;
  let role: string | undefined;
  for (const match of (str(input.prompt) ?? "").matchAll(claim)) {
    slice ??= match[1];
    if (role === undefined && match[1] === slice) role = roleOf(match);
  }
  if (slice === undefined) return undefined;
  return {
    kind: "spawn",
    toolUseId,
    slice,
    ...defined({ role, subagentType: str(input.subagent_type) }),
  };
}

function* spawnsOf(message: Json, claim: RegExp | undefined): Generator<SpawnEvent> {
  if (claim === undefined) return;
  for (const block of blocksOf(message)) {
    const spawn = spawnEvent(block, claim);
    if (spawn !== undefined) yield spawn;
  }
}

function toolUseEvent(
  envelope: Envelope,
  block: Json,
  gates: readonly RegExpAndName[],
): ToolUseEvent | undefined {
  const name = str(block.name);
  if (name === undefined) return undefined;
  const toolUseId = str(block.id);
  const input = isObject(block.input) ? block.input : {};
  const event: ToolUseEvent = { kind: "tool_use", ...envelope, name, ...defined({ toolUseId }) };
  if (name === "Read") {
    const filePath = str(input.file_path);
    if (filePath !== undefined) event.filePath = filePath;
  } else if (name === "Bash") {
    const command = str(input.command) ?? "";
    event.gates = gates.filter((gate) => gate.pattern.test(command)).map((gate) => gate.name);
  } else if (name === "Agent") {
    Object.assign(
      event,
      sliceAndRole(str(input.prompt) ?? ""),
      defined({ subagentType: str(input.subagent_type) }),
    );
  }
  return event;
}

interface RegExpAndName {
  name: string;
  pattern: RegExp;
}

function resultLength(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  let length = 0;
  for (const block of content) {
    if (isObject(block) && typeof block.text === "string") length += block.text.length;
  }
  return length;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (isObject(block) && typeof block.text === "string" ? block.text : ""))
    .join("");
}

function tag(text: string, name: string): string | undefined {
  return new RegExp(`<${name}>([^<]*)</${name}>`).exec(text)?.[1]?.trim();
}

function idTag(text: string, name: string): string | undefined {
  const value = tag(text, name);
  return value !== undefined && ID_PATTERN.test(value) ? value : undefined;
}

function numberTag(text: string, name: string): number | undefined {
  const value = tag(text, name);
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;
}

function taskNotification(envelope: Envelope, content: unknown): AuditEvent {
  const text = textOf(content);
  const open = text.indexOf("<result>");
  const close = text.lastIndexOf("</result>");
  const fields = defined({
    taskAgentId: idTag(text, "task-id"),
    toolUseId: idTag(text, "tool-use-id"),
    subagentTokens: numberTag(text, "subagent_tokens"),
    toolUses: numberTag(text, "tool_uses"),
    durationMs: numberTag(text, "duration_ms"),
    resultLength: open >= 0 && close > open ? close - open - "<result>".length : undefined,
  });
  return { kind: "task_notification", ...envelope, ...fields };
}

function metaEvent(meta: unknown): AuditEvent {
  const source = isObject(meta) ? meta : {};
  return {
    kind: "meta",
    ...defined({ agentType: str(source.agentType), toolUseId: str(source.toolUseId) }),
  };
}

export async function* readClaudeCode(
  lines: AsyncIterable<string>,
  meta: unknown,
  gates: readonly string[],
  keep?: (cwd: string) => boolean,
  common?: string,
): AsyncGenerator<ReaderEvent, ReaderTally> {
  const gatePatterns = gates.map((name) => ({ name, pattern: gatePattern(name) }));
  const claim = common === undefined ? undefined : claimPattern(common);
  const tally = {
    linesRead: 0,
    linesNotUnderstood: 0,
    assistantRecords: 0,
    assistantMissingRequired: 0,
  };
  const versions = new Set<string>();
  const usageSeen = new Set<string>();

  let metaPending = meta !== undefined;
  if (metaPending && keep === undefined) {
    metaPending = false;
    yield metaEvent(meta);
  }
  let cwd: string | undefined;

  for await (const line of lines) {
    if (line.trim() === "") continue;
    tally.linesRead += 1;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      tally.linesNotUnderstood += 1;
      continue;
    }
    if (!isObject(record) || typeof record.type !== "string") {
      tally.linesNotUnderstood += 1;
      continue;
    }
    cwd = str(record.cwd) ?? cwd;
    if (keep !== undefined && (cwd === undefined || !keep(cwd))) {
      if (record.type === "assistant" && isObject(record.message)) {
        yield* spawnsOf(record.message, claim);
      }
      continue;
    }
    if (metaPending) {
      metaPending = false;
      yield metaEvent(meta);
    }
    const version = str(record.version);
    if (version !== undefined) versions.add(version);
    const rejects: Rejects = { count: 0 };
    const envelope = envelopeOf(record, rejects);
    const message = isObject(record.message) ? record.message : {};
    const messageId = idOf(message.id, rejects);
    const toolUseResult = isObject(record.toolUseResult) ? record.toolUseResult : {};
    let resumedAgentId = idOf(toolUseResult.resumedAgentId, rejects);
    if (rejects.count > 0) tally.linesNotUnderstood += 1;

    if (record.type === "assistant") {
      const requestId = str(record.requestId);
      const model = str(message.model);
      let usage = usageOf(message);
      if (model !== SYNTHETIC_MODEL) {
        tally.assistantRecords += 1;
        if (usage === undefined || messageId === undefined) tally.assistantMissingRequired += 1;
      }
      const key = messageId ?? requestId;
      if (usage !== undefined && key !== undefined) {
        if (usageSeen.has(key)) usage = undefined;
        else usageSeen.add(key);
      }
      const blocks = blocksOf(message);
      yield {
        kind: "assistant",
        ...envelope,
        ...defined({ messageId, requestId, model, usage }),
        blockTypes: blocks.map((block) => str(block.type) ?? "unknown"),
      };
      for (const block of blocks) {
        if (block.type !== "tool_use") continue;
        const event = toolUseEvent(envelope, block, gatePatterns);
        if (event !== undefined) yield event;
      }
      yield* spawnsOf(message, claim);
    } else if (record.type === "user") {
      const origin = isObject(record.origin) ? record.origin : {};
      if (origin.kind === "task-notification") {
        yield taskNotification(envelope, message.content);
        continue;
      }
      for (const block of blocksOf(message)) {
        if (block.type !== "tool_result") continue;
        const toolUseId = str(block.tool_use_id);
        yield {
          kind: "tool_result",
          ...envelope,
          ...defined({ toolUseId, resumedAgentId }),
          length: resultLength(block.content),
        };
        resumedAgentId = undefined;
      }
    } else if (!METADATA_TYPES.has(record.type) && !record.type.startsWith("artifact-")) {
      tally.linesNotUnderstood += 1;
    }
  }

  return { ...tally, versions: [...versions].sort() };
}

export function shapeCheckTrips(
  tally: Pick<ReaderTally, "assistantRecords" | "assistantMissingRequired">,
): boolean {
  if (tally.assistantRecords === 0) return false;
  return tally.assistantMissingRequired / tally.assistantRecords > SHAPE_CHECK_THRESHOLD;
}
