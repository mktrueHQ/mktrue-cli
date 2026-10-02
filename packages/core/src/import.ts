import type { TemplateManifest, TemplateTransform } from "@mktrue/contracts";
import { TRANSFORM_UNIT, relativePathSchema } from "@mktrue/contracts";

import { EXIT, type Finding } from "./findings.js";
import { scanSecrets } from "./secrets.js";
import { escapeContextForPath, escapeForContext, freeTextSlotKeys, substitute } from "./slots.js";
import { hashContent } from "./stamp.js";
import { includesFile } from "./template.js";

export const MIN_TOKENISE_LENGTH = 4;

export type ImportAction =
  "unchanged" | "lift" | "owed" | "conflict" | "gone" | "undecided" | "skipped";

export interface ReportedValue {
  readonly slot: string;
  readonly value: string;
  readonly why: string;
}

export interface Tokenisation {
  readonly text: string;
  readonly substituted: readonly string[];
  readonly reported: readonly ReportedValue[];
}

export interface ImportEntry {
  readonly path: string;
  readonly sourcePath: string;
  readonly action: ImportAction;
  readonly reason: string;
  readonly next?: string | undefined;
  readonly sourceHash?: string | undefined;
  readonly heldHash?: string | undefined;
  readonly lossy: boolean;
}

export interface ImportInput {
  readonly manifest: TemplateManifest;
  readonly values: ReadonlyMap<string, string>;
  readonly sources: Readonly<Record<string, unknown>>;
  readonly source: ReadonlyMap<string, string>;
  readonly template: ReadonlyMap<string, string>;
}

export interface ImportPlan {
  readonly entries: readonly ImportEntry[];
  readonly findings: readonly Finding[];
  readonly refusals: readonly Finding[];
  readonly counts: Readonly<Record<ImportAction, number>>;
  readonly undecided: readonly string[];
  readonly uncurated: readonly string[];
  readonly lossyPaths: readonly string[];
  readonly reported: readonly ReportedValue[];
}

function escapeLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compileTransform(find: string): RegExp {
  const anchoredStart = find.startsWith("^");
  const anchoredEnd = find.endsWith("$");
  const body = find.slice(anchoredStart ? 1 : 0, anchoredEnd ? find.length - 1 : undefined);

  let pattern = "";
  for (const match of body.matchAll(TRANSFORM_UNIT)) {
    const unit = match[0];
    pattern += unit.startsWith("\\") ? unit : escapeLiteral(unit);
  }

  const flags = anchoredStart || anchoredEnd ? "gm" : "g";
  return new RegExp(`${anchoredStart ? "^" : ""}${pattern}${anchoredEnd ? "$" : ""}`, flags);
}

export function applyTransforms(
  text: string,
  transforms: readonly TemplateTransform[],
): { text: string; lossy: boolean } {
  let out = text;
  let lossy = false;
  for (const transform of transforms) {
    const before = out;
    // A function, not the string: `$&` and `$'` are live in a replacement string.
    out = out.replace(compileTransform(transform.find), () => transform.replace);
    if (transform.lossy && out !== before) lossy = true;
  }
  return { text: out, lossy };
}

export function tokenise(
  text: string,
  values: ReadonlyMap<string, string>,
  allowed: readonly string[],
  path: string,
  freeText: ReadonlySet<string>,
): Tokenisation {
  const opted = new Set(allowed);
  const reported: ReportedValue[] = [];
  const usable: { slot: string; value: string }[] = [];

  for (const [slot, value] of values) {
    if (value === "") continue;
    if (!opted.has(slot)) {
      reported.push({ slot, value, why: "not in the tokenise list" });
      continue;
    }
    if (value.length < MIN_TOKENISE_LENGTH) {
      reported.push({
        slot,
        value,
        why: `shorter than ${MIN_TOKENISE_LENGTH} characters`,
      });
      continue;
    }
    usable.push({ slot, value });
  }

  usable.sort((a, b) => b.value.length - a.value.length || a.slot.localeCompare(b.slot));

  const context = escapeContextForPath(path);
  let out = text;
  const substituted: string[] = [];
  for (const { slot, value } of usable) {
    // The file may carry the raw answer or, where render escapes it, the escaped form
    // (substituteForFile's exact inverse): search for both, so a title or owner with a
    // character that escaping changes still tokenises.
    const escaped =
      freeText.has(slot) && context !== "none" ? escapeForContext(value, context) : value;
    const alternatives =
      escaped !== value
        ? `${escapeLiteral(escaped)}|${escapeLiteral(value)}`
        : escapeLiteral(value);
    const bounded = new RegExp(`(?<![A-Za-z0-9])(?:${alternatives})(?![A-Za-z0-9])`, "g");
    const next = out.replace(bounded, `__MKTRUE_${slot}__`);
    if (next !== out) substituted.push(slot);
    out = next;
  }

  return { text: out, substituted, reported };
}

export interface ImportSourcePath {
  readonly path: string;
  readonly sourcePath: string;
  readonly safe: boolean;
}

export function importSourcePaths(
  manifest: TemplateManifest,
  values: ReadonlyMap<string, string>,
  sources: Readonly<Record<string, unknown>>,
): ImportSourcePath[] {
  return manifest.files
    .filter((file) => !file.generated && includesFile(file.when, sources))
    .map((file) => {
      const sourcePath = substitute(file.path, values).text;
      return {
        path: file.path,
        sourcePath,
        safe: relativePathSchema.safeParse(sourcePath).success,
      };
    });
}

export function planImport(input: ImportInput): ImportPlan {
  const { manifest, values, sources, source, template } = input;
  const entries: ImportEntry[] = [];
  const findings: Finding[] = [];
  const refusals: Finding[] = [];
  const lossyPaths: string[] = [];
  const undecided: string[] = [];
  const uncurated: string[] = [];
  const reported = new Map<string, ReportedValue>();
  const freeText = freeTextSlotKeys(manifest.slots);

  for (const transform of manifest.transforms) {
    if (transform.lossy) continue;
    const refusal: Finding = {
      gate: "import",
      what: `${manifest.name} declares a transform (${transform.find}) that is not marked lossy`,
      why: "render does not reverse transforms, so importing through this one would not round-trip and the acceptance would be quietly wrong",
      fix: `mark it "lossy": true in templates/${manifest.name}/template.json, or remove it`,
      exit: EXIT.DECISION,
    };
    findings.push(refusal);
    refusals.push(refusal);
  }

  for (const file of manifest.files) {
    if (!file.generated || !includesFile(file.when, sources)) continue;
    entries.push({
      path: file.path,
      sourcePath: file.path,
      action: "skipped",
      reason: "generated · never lifted",
      lossy: false,
    });
  }

  const byTemplatePath = new Map(manifest.files.map((file) => [file.path, file] as const));

  for (const { path, sourcePath, safe } of importSourcePaths(manifest, values, sources)) {
    const file = byTemplatePath.get(path);
    if (file === undefined) continue;

    if (!safe) {
      const refusal: Finding = {
        gate: "import",
        what: `${path} becomes ${sourcePath} once the product's answers are put back into it`,
        why: "a substituted path is not the path the manifest was checked on, and this one no longer stays inside the source repository",
        fix: `correct the answer that lands in ${path}, or remove the slot from that path in templates/${manifest.name}/template.json`,
        exit: EXIT.USAGE,
      };
      findings.push(refusal);
      refusals.push(refusal);
      continue;
    }

    const held = template.get(path);
    const raw = source.get(sourcePath);
    const recorded = manifest.imported[path];

    if (raw === undefined) {
      if (held === undefined) {
        findings.push({
          gate: "import",
          what: `${manifest.name} names ${path}, which is in neither the product nor the template`,
          why: "the manifest is describing a file that does not exist on either side, so nothing can be compared",
          fix: `remove ${path} from templates/${manifest.name}/template.json, or add it to the product`,
          exit: EXIT.FINDINGS,
        });
        continue;
      }
      entries.push({
        path,
        sourcePath,
        action: "gone",
        reason: "the product no longer has it",
        lossy: false,
      });
      continue;
    }

    if (raw.includes("__MKTRUE_") && !file.verbatim) {
      const refusal: Finding = {
        gate: "import",
        what: `${sourcePath} already contains __MKTRUE_ and is not declared verbatim`,
        why: "an unexpected slot in lifted content renders as something nobody wrote, or as nothing at all, in every repository made from this template",
        fix: `remove the slot syntax from ${sourcePath}, or mark ${path} "verbatim": true in the manifest`,
        exit: EXIT.FINDINGS,
      };
      findings.push(refusal);
      refusals.push(refusal);
      continue;
    }

    const transformed = file.verbatim
      ? { text: raw, lossy: false }
      : applyTransforms(raw, manifest.transforms);
    const tokenised = file.verbatim
      ? { text: transformed.text, substituted: [], reported: [] as readonly ReportedValue[] }
      : tokenise(transformed.text, values, manifest.tokenise, path, freeText);
    for (const item of tokenised.reported) {
      if (!reported.has(item.slot)) reported.set(item.slot, item);
    }
    if (transformed.lossy) lossyPaths.push(path);

    const next = tokenised.text;

    const secrets = scanSecrets(sourcePath, next);
    if (secrets.length > 0) {
      findings.push(...secrets);
      refusals.push(...secrets);
      continue;
    }

    if (held === undefined) {
      entries.push({
        path,
        sourcePath,
        action: "undecided",
        reason: "not in the template",
        next,
        lossy: transformed.lossy,
      });
      undecided.push(path);
      uncurated.push(path);
      continue;
    }

    const sourceHash = hashContent(next);
    const heldHash = hashContent(held);
    const hashes = { sourceHash, heldHash, lossy: transformed.lossy };

    if (recorded === undefined) {
      if (sourceHash === heldHash) {
        entries.push({
          path,
          sourcePath,
          action: "unchanged",
          reason: "identical on both sides",
          next,
          ...hashes,
        });
        continue;
      }
      entries.push({
        path,
        sourcePath,
        action: "undecided",
        reason: "no recorded baseline",
        next,
        ...hashes,
      });
      undecided.push(path);
      continue;
    }

    const curation = manifest.curated[path] ?? recorded;
    const productMoved = sourceHash !== recorded;
    const templateMoved = heldHash !== curation;

    if (!productMoved && !templateMoved) {
      entries.push({
        path,
        sourcePath,
        action: "unchanged",
        reason: "identical on both sides",
        next,
        ...hashes,
      });
    } else if (productMoved && !templateMoved && curation === recorded) {
      entries.push({
        path,
        sourcePath,
        action: "lift",
        reason: "the product moved",
        next,
        ...hashes,
      });
    } else if (productMoved && !templateMoved) {
      entries.push({
        path,
        sourcePath,
        action: "conflict",
        reason: "the product moved · curated",
        ...hashes,
      });
      findings.push({
        gate: "import",
        what: `${sourcePath} moved and templates/${manifest.name}/${path} is curated`,
        why: "lifting would discard the curation the template applies to this file",
        fix: `carry the change into the template by hand, then run mktrue import --adopt-template`,
        exit: EXIT.DECISION,
      });
    } else if (!productMoved && templateMoved) {
      entries.push({ path, sourcePath, action: "owed", reason: "the template moved", ...hashes });
      findings.push({
        gate: "import",
        what: `${path} moved in the template and not in ${sourcePath}`,
        why: "the template carries a fix the product it was lifted from never received, which is the fork appearing",
        fix: `run mktrue sync in the product, or take the template's version deliberately`,
        exit: EXIT.FINDINGS,
      });
    } else if (sourceHash === heldHash) {
      entries.push({
        path,
        sourcePath,
        action: "unchanged",
        reason: "both changed to the same content",
        next,
        ...hashes,
      });
    } else {
      entries.push({
        path,
        sourcePath,
        action: "conflict",
        reason: "both changed · neither taken",
        ...hashes,
      });
      findings.push({
        gate: "import",
        what: `${path} changed in the template and in ${sourcePath}`,
        why: "lifting would discard the template's change; leaving it would lose the product's",
        fix: `compare templates/${manifest.name}/${path} with ${sourcePath}, settle it by hand, then import again`,
        exit: EXIT.DECISION,
      });
    }
  }

  const safeEntries: ImportEntry[] =
    refusals.length === 0
      ? entries
      : entries.map(({ next: _next, sourceHash: _source, heldHash: _held, ...rest }) => rest);

  const counts: Record<ImportAction, number> = {
    unchanged: 0,
    lift: 0,
    owed: 0,
    conflict: 0,
    gone: 0,
    undecided: 0,
    skipped: 0,
  };
  for (const entry of entries) counts[entry.action] += 1;

  return {
    entries: safeEntries,
    findings,
    refusals,
    counts,
    undecided: [...undecided].sort(),
    uncurated: [...uncurated].sort(),
    lossyPaths: [...lossyPaths].sort(),
    reported: [...reported.values()].sort((a, b) => a.slot.localeCompare(b.slot)),
  };
}

export function importedAfterWrite(
  imported: Readonly<Record<string, string>>,
  plan: ImportPlan,
  landed?: ReadonlySet<string>,
): Record<string, string> {
  const updated: Record<string, string> = { ...imported };
  for (const entry of plan.entries) {
    if (entry.action === "lift" && entry.next !== undefined) {
      if (landed !== undefined && !landed.has(entry.path)) continue;
      updated[entry.path] = hashContent(entry.next);
    } else if (
      entry.action === "unchanged" &&
      entry.next !== undefined &&
      imported[entry.path] === undefined
    ) {
      updated[entry.path] = hashContent(entry.next);
    }
  }
  return updated;
}

export function importedAfterAdopt(
  imported: Readonly<Record<string, string>>,
  plan: ImportPlan,
): Record<string, string> {
  const updated: Record<string, string> = { ...imported };
  const uncurated = new Set(plan.uncurated);
  for (const entry of plan.entries) {
    if (entry.sourceHash === undefined || uncurated.has(entry.path)) continue;
    updated[entry.path] = entry.sourceHash;
  }
  return updated;
}

export function curatedAfterAdopt(
  curated: Readonly<Record<string, string>>,
  plan: ImportPlan,
): Record<string, string> {
  const updated: Record<string, string> = { ...curated };
  const uncurated = new Set(plan.uncurated);
  for (const { path, sourceHash, heldHash } of plan.entries) {
    if (sourceHash === undefined || heldHash === undefined || uncurated.has(path)) continue;
    if (heldHash === sourceHash) delete updated[path];
    else updated[path] = heldHash;
  }
  return updated;
}
