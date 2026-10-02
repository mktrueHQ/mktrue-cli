import { z } from "zod";

const count = z.number().int().nonnegative();

const envelope = {
  sessionId: z.string().optional(),
  agentId: z.string().optional(),
  uuid: z.string().optional(),
  timestamp: z.string().optional(),
  cwd: z.string().optional(),
  gitBranch: z.string().optional(),
  version: z.string().optional(),
  isSidechain: z.boolean().optional(),
};

const auditUsageSchema = z
  .object({
    input: count,
    output: count,
    cacheRead: count,
    cacheCreation: count,
  })
  .strict();

const assistantEventSchema = z
  .object({
    kind: z.literal("assistant"),
    ...envelope,
    messageId: z.string().optional(),
    requestId: z.string().optional(),
    model: z.string().optional(),
    usage: auditUsageSchema.optional(),
    blockTypes: z.array(z.string()),
  })
  .strict();

const toolUseEventSchema = z
  .object({
    kind: z.literal("tool_use"),
    ...envelope,
    toolUseId: z.string().optional(),
    name: z.string(),
    filePath: z.string().optional(),
    gates: z.array(z.string()).optional(),
    slice: z.string().optional(),
    role: z.string().optional(),
    subagentType: z.string().optional(),
  })
  .strict();

const toolResultEventSchema = z
  .object({
    kind: z.literal("tool_result"),
    ...envelope,
    toolUseId: z.string().optional(),
    length: count,
    resumedAgentId: z.string().optional(),
  })
  .strict();

const taskNotificationEventSchema = z
  .object({
    kind: z.literal("task_notification"),
    ...envelope,
    taskAgentId: z.string().optional(),
    toolUseId: z.string().optional(),
    subagentTokens: count.optional(),
    toolUses: count.optional(),
    durationMs: count.optional(),
    resultLength: count.optional(),
  })
  .strict();

const metaEventSchema = z
  .object({
    kind: z.literal("meta"),
    agentType: z.string().optional(),
    toolUseId: z.string().optional(),
  })
  .strict();

const spawnEventSchema = z
  .object({
    kind: z.literal("spawn"),
    toolUseId: z.string(),
    slice: z.string(),
    role: z.string().optional(),
    subagentType: z.string().optional(),
  })
  .strict();

export const auditEventSchema = z.discriminatedUnion("kind", [
  assistantEventSchema,
  toolUseEventSchema,
  toolResultEventSchema,
  taskNotificationEventSchema,
  metaEventSchema,
]);

export const readerEventSchema = z.discriminatedUnion("kind", [
  assistantEventSchema,
  toolUseEventSchema,
  toolResultEventSchema,
  taskNotificationEventSchema,
  metaEventSchema,
  spawnEventSchema,
]);

export const readerTallySchema = z
  .object({
    linesRead: count,
    linesNotUnderstood: count,
    assistantRecords: count,
    assistantMissingRequired: count,
    versions: z.array(z.string()),
  })
  .strict();

export const AUDIT_BUCKETS = [
  "<20k",
  "20–50k",
  "50–100k",
  "100–150k",
  "150–200k",
  "≥200k",
] as const;

const processedSchema = z
  .object({
    uncachedInput: count,
    cacheRead: count,
    cacheWrite: count,
    output: count,
  })
  .strict();

const distributionSchema = z
  .object({
    count,
    median: count.nullable(),
    p90: count.nullable(),
    max: count.nullable(),
  })
  .strict();

const callsBeforeAfterSchema = z.object({ calls: count, finalContext: count }).strict();

export const auditReportSchema = z
  .object({
    schema: z.literal(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reader: z
      .object({
        id: z.string(),
        testedFrom: z.string(),
        testedTo: z.string(),
        linesNotUnderstood: count,
        versionsSeen: z.array(z.string()),
      })
      .strict(),
    scope: z
      .object({
        dirsRead: count,
        filesRead: count,
        linesRead: count,
        recordsKept: count,
        keptByClaim: count,
        outsideRootSkipped: count,
        unreadable: count,
      })
      .strict(),
    gates: z.array(z.string()),
    histogram: z
      .array(z.object({ bucket: z.enum(AUDIT_BUCKETS), lead: count, subagents: count }).strict())
      .length(AUDIT_BUCKETS.length),
    fixedReading: z.object({ lead: distributionSchema, subagents: distributionSchema }).strict(),
    reReads: z
      .object({
        count,
        characters: count,
        top: z.array(z.object({ path: z.string(), reReads: count }).strict()).max(10),
      })
      .strict(),
    leads: z.array(
      z
        .object({
          sessionId: z.string(),
          branch: z.string().nullable(),
          tree: z.string(),
          calls: count,
          finalContext: count,
          processed: processedSchema,
        })
        .strict(),
    ),
    agents: z.array(
      z
        .object({
          agentId: z.string(),
          sessionId: z.string(),
          slice: z.string().nullable(),
          role: z.string(),
          model: z.string().nullable(),
          calls: count,
          finalContext: count,
          subagentTokens: count.nullable(),
          processed: processedSchema,
          durationMs: count.nullable(),
          reportChars: count.nullable(),
        })
        .strict(),
    ),
    resumed: z.array(
      z
        .object({
          agentId: z.string(),
          resumes: count,
          before: callsBeforeAfterSchema,
          after: callsBeforeAfterSchema,
        })
        .strict(),
    ),
    gateRuns: z.array(z.object({ gate: z.string(), runs: count }).strict()),
    slices: z.array(
      z
        .object({
          slice: z.string().nullable(),
          agents: count,
          calls: count,
          finalContextSum: count,
          processed: processedSchema,
          reReads: count,
          gateRuns: count,
          resumes: count,
        })
        .strict(),
    ),
    totals: z
      .object({
        agents: count,
        slices: count,
        calls: count,
        finalContextSum: count,
        resumes: count,
        reReads: count,
        gateRuns: count,
      })
      .strict(),
  })
  .strict();

export type AuditUsage = z.infer<typeof auditUsageSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type SpawnEvent = z.infer<typeof spawnEventSchema>;
export type ReaderEvent = z.infer<typeof readerEventSchema>;
export type ReaderTally = z.infer<typeof readerTallySchema>;
export type Processed = z.infer<typeof processedSchema>;
export type AuditReport = z.infer<typeof auditReportSchema>;
