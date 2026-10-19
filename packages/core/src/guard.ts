import type { AuditUsage, ContextBudgets } from "@mktrue/contracts";

export type GuardSession = "lead" | "subagent";

export type GuardDecision =
  | { readonly kind: "allow" }
  | { readonly kind: "warn"; readonly text: string }
  | { readonly kind: "deny"; readonly text: string };

export const RESUME_FILE = "resume.md";

/** Claude Code caps a hook's additionalContext at 10 000 characters. */
export const HOOK_CONTEXT_MAX = 10_000;

const SLICE_ID = "[A-Za-z0-9][A-Za-z0-9._-]*";

/** The context the next call starts from: everything the last one read and wrote. */
export function contextOfUsage(usage: AuditUsage): number {
  return usage.input + usage.cacheRead + usage.cacheCreation + usage.output;
}

const thousands = (tokens: number): string => `${Math.round(tokens / 1000)}k`;

export function guardDecision(input: {
  readonly budgets: ContextBudgets;
  readonly session: GuardSession;
  readonly context: number;
  readonly calls: number;
  readonly handoff: boolean;
}): GuardDecision {
  const { budgets, context, calls } = input;
  if (input.session === "lead") {
    const { warn, ceiling } = budgets.lead;
    if (context > ceiling) {
      if (input.handoff) return { kind: "allow" };
      return {
        kind: "deny",
        text:
          `mktrue: guard · lead context ${thousands(context)} is past the ` +
          `${thousands(ceiling)} ceiling · this call is refused · the one call allowed is ` +
          `writing <main checkout>/.mktrue/slices/<slice-id>/${RESUME_FILE} (what is done, ` +
          `what is next, the files to read); write it, stop, and ask the founder to /clear`,
      };
    }
    if (context >= warn) {
      return {
        kind: "warn",
        text:
          `mktrue: guard · lead context ${thousands(context)} · budget ${thousands(warn)} · ` +
          `write <slice folder>/${RESUME_FILE} (what is done, what is next, the files to ` +
          `read), stop, and ask the founder to /clear · past ${thousands(ceiling)} every ` +
          `call but that write is refused`,
      };
    }
    return { kind: "allow" };
  }

  const { warn, calls: callBudget, ceiling } = budgets.subagent;
  if (context > ceiling) {
    return {
      kind: "deny",
      text:
        `mktrue: guard · subagent context ${thousands(context)} is past the ` +
        `${thousands(ceiling)} ceiling · every tool call is refused · return your report ` +
        `now as your final message: what is done, what is left, what needs a ruling`,
    };
  }
  if (context >= warn || calls >= callBudget) {
    return {
      kind: "warn",
      text:
        `mktrue: guard · subagent context ${thousands(context)} of ${thousands(warn)} · ` +
        `${calls} of ${callBudget} calls · finish the step you are on, then return your ` +
        `report as your final message · past ${thousands(ceiling)} every call is refused`,
    };
  }
  return { kind: "allow" };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whether a tool call writes the lead's hand-off file in the main checkout's slice folder. */
export function isHandoffWrite(
  toolName: string | undefined,
  toolInput: Readonly<Record<string, unknown>> | undefined,
  mainCheckout: string | undefined,
): boolean {
  if (toolName !== "Write" && toolName !== "Edit") return false;
  if (mainCheckout === undefined || mainCheckout === "" || mainCheckout.endsWith("/")) {
    return false;
  }
  const filePath = toolInput?.file_path;
  if (typeof filePath !== "string") return false;
  const pattern = new RegExp(
    `^${escapeRegExp(mainCheckout)}/\\.mktrue/slices/${SLICE_ID}/${escapeRegExp(RESUME_FILE)}$`,
  );
  return pattern.test(filePath);
}

/** The stdout a PreToolUse hook prints for a decision: JSON, or nothing at all. */
export function preToolUseOutput(decision: GuardDecision): string | undefined {
  if (decision.kind === "allow") return undefined;
  const hookSpecificOutput =
    decision.kind === "deny"
      ? {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: decision.text,
        }
      : { hookEventName: "PreToolUse", additionalContext: decision.text };
  return JSON.stringify({ hookSpecificOutput });
}

/** The stdout a SessionStart hook prints to put a hand-off file in context. */
export function sessionStartOutput(path: string, content: string): string {
  const head = `mktrue: guard · resuming from ${path}\n\n`;
  const room = HOOK_CONTEXT_MAX - head.length;
  const cut = `\n\n[cut at ${HOOK_CONTEXT_MAX} characters; read the rest at ${path}]`;
  const body = content.length <= room ? content : content.slice(0, room - cut.length) + cut;
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: head + body },
  });
}
