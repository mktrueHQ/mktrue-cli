import { z } from "zod";

const tokens = z.number().int().positive();

export const contextBudgetsSchema = z
  .object({
    lead: z
      .object({ warn: tokens.default(150_000), ceiling: tokens.default(200_000) })
      .strict()
      .default({}),
    subagent: z
      .object({
        warn: tokens.default(200_000),
        calls: z.number().int().positive().default(150),
        ceiling: tokens.default(250_000),
      })
      .strict()
      .default({}),
  })
  .strict()
  .default({})
  .refine(
    (budgets) =>
      budgets.lead.warn <= budgets.lead.ceiling &&
      budgets.subagent.warn <= budgets.subagent.ceiling,
    "a warning sits at or below its ceiling",
  );

const ID = /^[A-Za-z0-9_-]{1,128}$/;

const absolutePath = z
  .string()
  .min(1)
  .max(4096)
  .refine((path) => /^(?:\/|[A-Za-z]:[\\/])/.test(path), "an absolute path")
  .refine((path) => !path.includes("\0"), "holds a NUL");

export const hookInputSchema = z.object({
  session_id: z.string().regex(ID),
  transcript_path: absolutePath,
  cwd: absolutePath,
  hook_event_name: z.string().min(1),
  agent_id: z.string().regex(ID).optional(),
  source: z.string().optional(),
  tool_name: z.string().optional(),
  tool_input: z.record(z.unknown()).optional(),
});

export type ContextBudgets = z.infer<typeof contextBudgetsSchema>;
export type HookInput = z.infer<typeof hookInputSchema>;
