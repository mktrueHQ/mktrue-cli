import { z } from "zod";

const count = z.number().int().nonnegative();

function climbsPastParent(path: string): boolean {
  let depth = 0;
  for (const segment of path.split("/")) {
    if (segment === "..") depth -= 1;
    else if (segment !== "." && segment !== "") depth += 1;
    if (depth < -1) return true;
  }
  return false;
}

export const shownPathSchema = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !p.startsWith("\\") && !/^[A-Za-z]:/.test(p), {
    message: "a shown path is relative to the repository root",
  })
  .refine((p) => !p.startsWith("~"), { message: "a shown path never names a home directory" })
  .refine((p) => !climbsPastParent(p), {
    message: "a shown path never climbs above the repository's parent",
  });

export const SIBLING_CODES = [
  "sibling-kit",
  "sibling-behind",
  "sibling-owned",
  "sibling-edited",
  "sibling-pinned",
  "sibling-one-way",
  "sibling-unreadable",
] as const;

export const planCountsSchema = z
  .object({ update: count, conflict: count, removed: count, new: count })
  .strict();

const stateFields = {
  kit: z.string().min(1),
  owned: count,
  edited: count,
  pinned: count,
  plan: planCountsSchema,
};

const selfRowSchema = z
  .object({ path: z.literal("."), ref: z.literal("working tree"), ...stateFields })
  .strict();

const readableSiblingSchema = z
  .object({
    entry: count,
    path: shownPathSchema,
    readable: z.literal(true),
    ref: z.string().min(1),
    commit: z.string().regex(/^[0-9a-f]{4,64}$/),
    listsBack: z.boolean(),
    ...stateFields,
  })
  .strict();

const unreadableSiblingSchema = z
  .object({
    entry: count,
    path: shownPathSchema.nullable(),
    readable: z.literal(false),
    why: z.string().min(1),
  })
  .strict();

export const siblingRowSchema = z.discriminatedUnion("readable", [
  readableSiblingSchema,
  unreadableSiblingSchema,
]);

const exitSchema = z.number().int().min(0).max(5);

export const siblingFindingSchema = z
  .object({
    code: z.enum(SIBLING_CODES),
    entry: count,
    path: shownPathSchema.nullable(),
    what: z.string().min(1),
    why: z.string().min(1),
    fix: z.string().min(1),
    exit: exitSchema,
  })
  .strict();

export const siblingsReportSchema = z
  .object({
    schema: z.literal(1),
    kit: z.string().min(1),
    self: selfRowSchema,
    siblings: z.array(siblingRowSchema),
    findings: z.array(siblingFindingSchema),
    gates: z.object({ findings: count, exit: exitSchema }).strict(),
    exit: exitSchema,
  })
  .strict();

export type PlanCounts = z.infer<typeof planCountsSchema>;
export type SiblingCode = (typeof SIBLING_CODES)[number];
export type SiblingRow = z.infer<typeof siblingRowSchema>;
export type SiblingFindingRecord = z.infer<typeof siblingFindingSchema>;
export type SiblingsReport = z.infer<typeof siblingsReportSchema>;
