import { posix, win32 } from "node:path";

import { countToolCalls, lastUsage, linesBackward } from "@mktrue/audit";
import { contextBudgetsSchema, hookInputSchema, type HookInput } from "@mktrue/contracts";
import {
  contextOfUsage,
  EXIT,
  guardDecision,
  isHandoffWrite,
  preToolUseOutput,
  sessionStartOutput,
  type ExitCode,
} from "@mktrue/core";

import type { GuardPorts } from "../ports.js";

/** A subagent's possible transcripts, the hook's own path first, in that path's separators. */
export function subagentTranscripts(input: HookInput, agentId: string): string[] {
  const { basename, dirname, join } = input.transcript_path.includes("\\") ? win32 : posix;
  const names = [
    `agent-${agentId}.jsonl`,
    ...(agentId.startsWith("agent-") ? [`${agentId}.jsonl`] : []),
  ];
  if (names.includes(basename(input.transcript_path))) return [input.transcript_path];
  const folder = join(dirname(input.transcript_path), input.session_id, "subagents");
  return names.map((name) => join(folder, name));
}

function parse(text: string | undefined): HookInput | undefined {
  if (text === undefined) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = hookInputSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

function budgetsOf(text: string) {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  const budgets =
    typeof raw === "object" && raw !== null ? (raw as { budgets?: unknown }).budgets : undefined;
  const context =
    typeof budgets === "object" && budgets !== null
      ? (budgets as { context?: unknown }).context
      : undefined;
  const parsed = contextBudgetsSchema.safeParse(context);
  return parsed.success ? parsed.data : undefined;
}

async function preToolUse(ports: GuardPorts, input: HookInput): Promise<string | undefined> {
  const config = ports.config(input.cwd);
  if (config === undefined) return undefined;
  const budgets = budgetsOf(config.text);
  if (budgets === undefined) return undefined;

  const session = input.agent_id === undefined ? "lead" : "subagent";
  const transcript =
    input.agent_id === undefined
      ? input.transcript_path
      : subagentTranscripts(input, input.agent_id).find((path) => ports.exists(path));
  if (transcript === undefined) return undefined;

  const usage = lastUsage(linesBackward(ports.tail(transcript)));
  if (usage === undefined) return undefined;
  const context = contextOfUsage(usage);
  const calls = session === "subagent" ? countToolCalls(linesBackward(ports.tail(transcript))) : 0;

  const measured = { budgets, session, context, calls } as const;
  let decision = guardDecision({ ...measured, handoff: false });
  const writes = input.tool_name === "Write" || input.tool_name === "Edit";
  if (decision.kind === "deny" && session === "lead" && writes) {
    const main = await ports.mainCheckout(config.root);
    if (isHandoffWrite(input.tool_name, input.tool_input, main)) {
      decision = guardDecision({ ...measured, handoff: true });
    }
  }
  return preToolUseOutput(decision);
}

async function sessionStart(ports: GuardPorts, input: HookInput): Promise<string | undefined> {
  if (input.source !== "clear") return undefined;
  const config = ports.config(input.cwd);
  if (config === undefined) return undefined;
  const main = await ports.mainCheckout(config.root);
  if (main === undefined) return undefined;
  const resume = ports.newestResume(main);
  return resume === undefined ? undefined : sessionStartOutput(resume.path, resume.content);
}

/** Exit 0 whatever happens: a hook that exits 2 blocks, and the guard never blocks by accident. */
export async function runGuard(ports: GuardPorts, options: { resume: boolean }): Promise<ExitCode> {
  try {
    const input = parse(await ports.stdin());
    if (input === undefined) return EXIT.TRUE;
    const output =
      options.resume && input.hook_event_name === "SessionStart"
        ? await sessionStart(ports, input)
        : !options.resume && input.hook_event_name === "PreToolUse"
          ? await preToolUse(ports, input)
          : undefined;
    if (output !== undefined) await ports.write(output);
  } catch {
    return EXIT.TRUE;
  }
  return EXIT.TRUE;
}
