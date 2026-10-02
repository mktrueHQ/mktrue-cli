import { z } from "zod";

import { relativePathSchema } from "./bench.js";

const documentPathSchema = z.union([relativePathSchema, z.literal("")]);

export const portSchema = z.number().int().min(1024).max(65535);

const REGION_MARKER = "<!-- mktrue:";

export const CONTROL_OR_INVISIBLE_CLASS = "\\p{Cc}\\p{Cf}\\u2028\\u2029\\uFFF9-\\uFFFB";

const CONTROL_OR_INVISIBLE = new RegExp(`[${CONTROL_OR_INVISIBLE_CLASS}]`, "u");

const ANSWER_MAX = 300;

const answerText = z
  .string()
  .min(1)
  .max(ANSWER_MAX)
  .refine((text) => !text.includes(REGION_MARKER), "holds a region marker")
  .refine((text) => !CONTROL_OR_INVISIBLE.test(text), "holds a control or invisible character");

// docs/architecture.md, "New": why these two lists (reserved databases, fixed env prefixes).
const MONGO_RESERVED_DATABASES = new Set(["admin", "local", "config"]);
const TEMPLATE_ENV_PREFIXES = ["MONGO", "BACKUP", "INFRA"];

function consumerEnvKey(slug: string): string {
  return slug.toUpperCase().replace(/-/g, "_");
}

function collidesWithTemplate(slug: string): boolean {
  if (MONGO_RESERVED_DATABASES.has(slug)) return true;
  const key = consumerEnvKey(slug);
  return TEMPLATE_ENV_PREFIXES.some((prefix) => key === prefix || key.startsWith(`${prefix}_`));
}

// MongoDB refuses a database name over 63 bytes, and a consumer's slug becomes one verbatim
// (docs/architecture.md, "New"): the cap has to hold before the render, not after bootstrap fails
// partway through with some consumers already created.
const CONSUMER_SLUG_MAX = 63;

const consumerSlug = z
  .string()
  .min(1)
  .max(CONSUMER_SLUG_MAX)
  .regex(/^[a-z][a-z0-9-]*$/, "a consumer is lowercase, digits and hyphens")
  .refine(
    (slug) => !collidesWithTemplate(slug),
    "a consumer name collides with a reserved database or the template's own keys",
  );

export const answersSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9-]*$/, "a name is lowercase, digits and hyphens"),
  title: answerText.optional(),
  purpose: answerText,
  owner: answerText,
  audienceTest: answerText,
  stakes: answerText,
  dataClasses: z.array(answerText),
  auth: answerText,
  database: z
    .object({
      name: answerText,
      user: answerText,
    })
    .strict()
    .optional(),
  ports: z.record(answerText, portSchema),
  languages: z.array(answerText).min(1),
  siblings: z.array(answerText),
  consumers: z
    .array(consumerSlug)
    .min(1, "at least one consumer")
    .refine((list) => new Set(list).size === list.length, "consumers must be unique")
    .optional(),
  skills: z.array(answerText),
});

export function declaresAnswer(path: string): boolean {
  const parts = path.split(".");
  if (parts.some((part) => part === "")) return false;

  const unwrap = (schema: z.ZodTypeAny): z.ZodTypeAny => {
    if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
      return unwrap(schema.unwrap() as z.ZodTypeAny);
    }
    if (schema instanceof z.ZodDefault) return unwrap(schema.removeDefault() as z.ZodTypeAny);
    return schema;
  };

  let node: z.ZodTypeAny = answersSchema;
  for (const part of parts) {
    const here = unwrap(node);
    if (here instanceof z.ZodObject) {
      const shape = here.shape as Record<string, z.ZodTypeAny | undefined>;
      if (!Object.hasOwn(shape, part)) return false;
      const next = shape[part];
      if (next === undefined) return false;
      node = next;
      continue;
    }
    if (here instanceof z.ZodRecord) {
      node = here.valueSchema as z.ZodTypeAny;
      continue;
    }
    return false;
  }
  return true;
}

export const budgetsSchema = z.object({
  rules: z.number().int().positive(),
  state: z.number().int().positive(),
  decision: z.number().int().positive(),
});

export const ownedSchema = z.record(
  relativePathSchema,
  z.string().regex(/^sha256-[0-9a-f]{64}$/, "expected sha256-<64 hex characters>"),
);

export const mktrueConfigSchema = z.object({
  schema: z.literal(1),
  kit: z.string().min(1),
  template: z
    .object({
      name: z.string().min(1),
      version: z.string().min(1),
    })
    .optional(),
  targets: z.array(z.string().min(1)).min(1),
  answers: answersSchema,
  budgets: budgetsSchema,
  auditTriggers: z.array(z.string().min(1)),
  gates: z.array(z.string().min(1)).optional(),
  baseBranch: z.string().min(1),
  paths: z
    .object({
      state: documentPathSchema.default("docs/STATE.md"),
      roadmap: documentPathSchema.default("docs/ROADMAP.md"),
      decisionsIndex: documentPathSchema.default("docs/decisions/index.md"),
      decisions: documentPathSchema.default("docs/decisions/*.md"),
      design: documentPathSchema.default("docs/design/*.md"),
      log: documentPathSchema.default("docs/log/"),
    })
    .default({}),
  pins: z.array(relativePathSchema),
  owned: ownedSchema,
  managed: z.record(relativePathSchema, z.record(z.string().min(1), z.string().min(1))).default({}),
});

export type Answers = z.infer<typeof answersSchema>;
export type Budgets = z.infer<typeof budgetsSchema>;
export type MktrueConfig = z.infer<typeof mktrueConfigSchema>;
