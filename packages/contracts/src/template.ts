import { z } from "zod";

import { relativePathSchema, slotKeySchema, slotSchema } from "./bench.js";

export const templateConditionSchema = z.object({
  answer: z.string().min(1),
  equals: z.union([z.string(), z.number(), z.boolean()]).optional(),
  includes: z.string().min(1).optional(),
  absent: z.boolean().optional(),
});

export const templateNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, "a template name is a slug");

export const templateFileSchema = z.object({
  path: relativePathSchema,
  executable: z.boolean().default(false),
  verbatim: z.boolean().default(false),
  replaces: z.boolean().default(false),
  generated: z.boolean().default(false),
  when: templateConditionSchema.optional(),
});

export const TRANSFORM_UNIT = /\\[dws]\{[0-9]{1,3}(?:,[0-9]{1,3})?\}|\\[dws]|[^\\]/g;

const BOUNDED_UNIT = /^\\[dws]\{([0-9]{1,3})(?:,([0-9]{1,3}))?\}$/;

export const MAX_TRANSFORM_LENGTH = 200;

export const MAX_TRANSFORM_RANGES = 3;

export const MAX_TRANSFORM_BACKTRACK = 1000;

export function transformPatternIsSafe(find: string): boolean {
  if (find.length > MAX_TRANSFORM_LENGTH) return false;
  const units = [...find.matchAll(TRANSFORM_UNIT)].map((match) => match[0]);
  if (units.join("") !== find) return false;

  let ranges = 0;
  let backtrack = 1;
  for (const unit of units) {
    const bounds = BOUNDED_UNIT.exec(unit);
    if (bounds === null) continue;
    const min = Number(bounds[1]);
    const max = bounds[2] === undefined ? min : Number(bounds[2]);
    if (max < min) return false;
    const width = max - min + 1;
    if (width === 1) continue;
    ranges += 1;
    backtrack *= width;
    if (ranges > MAX_TRANSFORM_RANGES || backtrack > MAX_TRANSFORM_BACKTRACK) return false;
  }
  return true;
}

export const templateTransformSchema = z.object({
  find: z.string().min(1).refine(transformPatternIsSafe, {
    message:
      "a transform pattern is literal text plus a few bounded \\d, \\w and \\s classes, not a free regex",
  }),
  replace: z.string(),
  lossy: z.boolean().default(false),
});

const baselineSchema = z
  .record(
    relativePathSchema,
    z.string().regex(/^sha256-[0-9a-f]{64}$/, "expected sha256-<64 hex characters>"),
  )
  .default({});

export const templateRequirementSchema = z.enum(["pnpm", "docker", "git"]);

export const templateManifestSchema = z.object({
  schema: z.literal(1),
  name: templateNameSchema,
  version: z.string().min(1),
  description: z.string().min(1),
  composes: z.array(templateNameSchema).default([]),
  slots: z.record(slotKeySchema, slotSchema),
  files: z.array(templateFileSchema).min(1),
  gates: z.array(z.string().min(1)),
  requires: z.array(templateRequirementSchema).default(["pnpm"]),
  transforms: z.array(templateTransformSchema).default([]),
  tokenise: z.array(slotKeySchema).default([]),
  imported: baselineSchema,
  curated: baselineSchema,
});

export type TemplateRequirement = z.infer<typeof templateRequirementSchema>;
export type TemplateCondition = z.infer<typeof templateConditionSchema>;
export type TemplateFile = z.infer<typeof templateFileSchema>;
export type TemplateTransform = z.infer<typeof templateTransformSchema>;
export type TemplateManifest = z.infer<typeof templateManifestSchema>;
