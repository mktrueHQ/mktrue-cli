import { z } from "zod";

export const slotKeySchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]*$/, "a slot key is SCREAMING_SNAKE_CASE");

export const relativePathSchema = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !p.startsWith("\\") && !/^[A-Za-z]:/.test(p), {
    message: "a path must be relative to the repository root",
  })
  .refine((p) => !p.split(/[\\/]/).includes(".."), {
    message: "a path must not climb out of the repository with ..",
  })
  .refine((p) => !/[\u0000-\u001f]/.test(p), {
    message: "a path must not contain control characters",
  });

export const safeIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, "an id is lowercase letters, digits and hyphens");

export const frontmatterTextSchema = z
  .string()
  .min(1)
  .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), {
    message: "frontmatter text must not contain control characters or newlines",
  });

export const slotKindSchema = z.enum(["text", "list", "number", "path"]);

export const slotSchema = z.object({
  from: z.string().min(1),
  required: z.boolean(),
  kind: slotKindSchema,
  // docs/architecture.md, "Rendering is deterministic": what this overrides, and why.
  separator: z.string().min(1).max(4).optional(),
});

export const roleSchema = z.object({
  id: safeIdSchema,
  title: z.string().min(1),
  body: relativePathSchema,
  description: frontmatterTextSchema,
  tools: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, "a tool is an identifier")).min(1),
  model: frontmatterTextSchema.optional(),
  effort: z.union([z.string().min(1), z.number().int().positive()]).optional(),
  slots: z.array(slotKeySchema),
  report: z.string().min(1),
});

export const commandSchema = z.object({
  id: safeIdSchema,
  title: z.string().min(1),
  body: relativePathSchema,
  slots: z.array(slotKeySchema),
});

export const rulesOwnerSchema = z.enum(["kit", "repo"]);

export const rulesSectionSchema = z.object({
  section: z.number().int().positive(),
  title: z.string().min(1),
  body: relativePathSchema,
  owner: rulesOwnerSchema,
  slots: z.array(slotKeySchema),
});

export const documentSchema = z.object({
  id: safeIdSchema,
  title: z.string().min(1),
  body: relativePathSchema,
  renderTo: relativePathSchema,
  slots: z.array(slotKeySchema),
});

export const contractDocumentSchema = z.object({
  id: safeIdSchema,
  title: z.string().min(1),
  body: relativePathSchema,
  renderTo: relativePathSchema,
  slots: z.array(slotKeySchema),
});

export const workflowSchema = z.object({
  id: safeIdSchema,
  title: z.string().min(1),
  body: relativePathSchema,
  renderTo: relativePathSchema,
  slots: z.array(slotKeySchema),
});

export const releasePinSchema = z
  .object({
    version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, "a release version is x.y.z"),
    sha256: z.string().regex(/^[0-9a-f]{64}$/, "a release sha256 is 64 lowercase hex characters"),
  })
  .strict();

export const targetVocabularySchema = z.object({
  models: z.array(z.string().min(1)).min(1),
  efforts: z.array(z.string().min(1)).min(1),
  effortUnsupportedOn: z.array(z.string().min(1)),
});

export const targetSchema = z.object({
  roles: relativePathSchema,
  commands: relativePathSchema,
  rules: relativePathSchema,
  settings: relativePathSchema,
  roleFrontmatter: z.array(z.string().min(1)).min(1),
  vocabulary: targetVocabularySchema,
});

const baseBenchManifestSchema = z.object({
  schema: z.literal(1),
  version: z.string().min(1),
  slotSyntax: z.string().min(1),
  slots: z.record(slotKeySchema, slotSchema),
  roles: z.array(roleSchema).min(1),
  contracts: z.array(contractDocumentSchema),
  commands: z.array(commandSchema).min(1),
  workflows: z.array(workflowSchema).default([]),
  rules: z.array(rulesSectionSchema).min(1),
  docs: z.array(documentSchema),
  targets: z.record(z.string().min(1), targetSchema),
});

export const benchManifestSchema = baseBenchManifestSchema.superRefine((manifest, ctx) => {
  const declared = new Set(Object.keys(manifest.slots));

  const entries = [
    ...manifest.roles.map((r) => ({ name: `role ${r.id}`, slots: r.slots })),
    ...manifest.contracts.map((c) => ({ name: `contract ${c.id}`, slots: c.slots })),
    ...manifest.commands.map((c) => ({ name: `command ${c.id}`, slots: c.slots })),
    ...manifest.workflows.map((w) => ({ name: `workflow ${w.id}`, slots: w.slots })),
    ...manifest.rules.map((r) => ({ name: `rules section ${r.section}`, slots: r.slots })),
    ...manifest.docs.map((d) => ({ name: `document ${d.id}`, slots: d.slots })),
  ];

  for (const entry of entries) {
    for (const slot of entry.slots) {
      if (!declared.has(slot)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${entry.name} declares slot ${slot}, which is not in slots`,
          path: ["slots", slot],
        });
      }
    }
  }

  for (const workflow of manifest.workflows) {
    for (const slot of workflow.slots) {
      if (manifest.slots[slot]?.from.startsWith("release.") !== false) continue;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `workflow ${workflow.id} takes ${slot} from outside the kit's release pin`,
        path: ["workflows", workflow.id, "slots"],
      });
    }
  }

  for (const [targetName, target] of Object.entries(manifest.targets)) {
    const models = new Set(target.vocabulary.models);
    const efforts = new Set(target.vocabulary.efforts);
    const silentlyIgnores = new Set(target.vocabulary.effortUnsupportedOn);

    for (const role of manifest.roles) {
      // A full model id, the only form with hyphens, is never in a vocabulary.
      if (role.model !== undefined && !models.has(role.model) && !role.model.includes("-")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `role ${role.id} has model "${role.model}", which ${targetName} does not accept`,
          path: ["roles", role.id, "model"],
        });
      }

      if (typeof role.effort === "string" && !efforts.has(role.effort)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `role ${role.id} has effort "${role.effort}", which ${targetName} does not accept`,
          path: ["roles", role.id, "effort"],
        });
      }

      if (
        role.effort !== undefined &&
        role.model !== undefined &&
        silentlyIgnores.has(role.model)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `role ${role.id} sets an effort on ${role.model}, which ignores it`,
          path: ["roles", role.id, "effort"],
        });
      }
    }
  }

  const sections = manifest.rules.map((r) => r.section);
  if (new Set(sections).size !== sections.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "two rules sections share a number",
      path: ["rules"],
    });
  }
});

export type BenchManifest = z.infer<typeof baseBenchManifestSchema>;
export type Role = z.infer<typeof roleSchema>;
export type RulesSection = z.infer<typeof rulesSectionSchema>;
export type Target = z.infer<typeof targetSchema>;
export type Workflow = z.infer<typeof workflowSchema>;
export type ReleasePin = z.infer<typeof releasePinSchema>;
