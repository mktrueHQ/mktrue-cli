import type { TemplateManifest } from "@mktrue/contracts";

import { EXIT, type Finding } from "./findings.js";
import { slotValues } from "./slots.js";
import { renderTemplate, type RenderedTemplateFile } from "./template.js";

export interface TemplateSource {
  readonly manifest: TemplateManifest;
  readonly contents: ReadonlyMap<string, string>;
}

export interface Replacement {
  readonly template: string;
  readonly path: string;
}

interface Layer {
  readonly template: string;
  readonly files: readonly { readonly path: string; readonly replaces: boolean }[];
}

const refusal = (what: string, why: string, fix: string): Finding => ({
  gate: "templates",
  what,
  why,
  fix,
  exit: EXIT.FINDINGS,
});

function composedBases<T extends { readonly manifest: TemplateManifest }>(
  overlay: TemplateManifest,
  available: readonly T[],
): { findings: Finding[]; bases: T[] } {
  const findings: Finding[] = [];
  const bases: T[] = [];

  for (const name of overlay.composes) {
    const base = available.find((source) => source.manifest.name === name);
    if (base === undefined) {
      findings.push(
        refusal(
          `${overlay.name} composes ${name}, which is not a template`,
          "a composite missing its base renders only its overlay, and would look whole",
          `add templates/${name}, or remove it from composes in ${overlay.name}`,
        ),
      );
      continue;
    }
    if (base.manifest.composes.length > 0) {
      findings.push(
        refusal(
          `${overlay.name} composes ${name}, which composes ${base.manifest.composes.join(", ")}`,
          "composition is one level; a composite of a composite is refused, not flattened",
          `compose ${base.manifest.composes.join(", ")} directly from ${overlay.name}`,
        ),
      );
      continue;
    }
    bases.push(base);
  }

  const firstSeen = new Map<string, { template: string; from: string }>();
  for (const manifest of [...bases.map((base) => base.manifest), overlay]) {
    for (const [key, slot] of Object.entries(manifest.slots)) {
      const first = firstSeen.get(key);
      if (first === undefined) {
        firstSeen.set(key, { template: manifest.name, from: slot.from });
      } else if (first.from !== slot.from) {
        findings.push(
          refusal(
            `slot ${key} is ${first.from} in ${first.template}, ${slot.from} in ${manifest.name}`,
            "one slot name meaning two things renders one of them wrong, silently",
            `give ${key} the same from in both, or rename it in ${overlay.name}`,
          ),
        );
      }
    }
  }

  return { findings, bases };
}

function overlaps(bases: readonly Layer[], overlay: Layer): Finding[] {
  const findings: Finding[] = [];
  const renderedBy = new Map<string, string>();
  const overlap = (path: string, first: string, second: string): Finding =>
    refusal(
      `${path} is rendered by both ${first} and ${second}`,
      "one would overwrite the other, and nothing would say which won",
      `remove ${path} from one of them, or mark the overlay's file replaces: true`,
    );

  for (const base of bases) {
    for (const file of base.files) {
      const first = renderedBy.get(file.path);
      if (first === undefined) renderedBy.set(file.path, base.template);
      else findings.push(overlap(file.path, first, base.template));
    }
  }
  for (const file of overlay.files) {
    const base = renderedBy.get(file.path);
    if (base !== undefined && !file.replaces) {
      findings.push(overlap(file.path, base, overlay.template));
    }
  }
  return findings;
}

const replacesNothing = (template: string, path: string): Finding =>
  refusal(
    `${template} replaces ${path}, which no template it composes renders`,
    "a replaces with nothing to replace pre-authorises an overwrite the day a base adds that path",
    `remove replaces from ${path} in ${template}`,
  );

export function checkComposition(templates: readonly TemplateManifest[]): {
  findings: Finding[];
  composites: number;
  replaces: Replacement[];
} {
  const findings: Finding[] = [];
  const replaces: Replacement[] = [];
  const available = templates.map((manifest) => ({ manifest }));
  let composites = 0;

  for (const template of templates) {
    const set = composedBases(template, available);
    const everyBaseFound = set.bases.length === template.composes.length;
    const basePaths = new Set(
      set.bases.flatMap((base) => base.manifest.files.map((file) => file.path)),
    );
    for (const file of template.files) {
      if (!file.replaces) continue;
      replaces.push({ template: template.name, path: file.path });
      if (everyBaseFound && !basePaths.has(file.path)) {
        findings.push(replacesNothing(template.name, file.path));
      }
    }
    if (template.composes.length === 0) continue;
    composites += 1;

    const declared = (manifest: TemplateManifest): Layer => ({
      template: manifest.name,
      files: manifest.files,
    });
    findings.push(
      ...set.findings,
      ...overlaps(
        set.bases.map((base) => declared(base.manifest)),
        declared(template),
      ),
    );
  }

  return { findings, composites, replaces };
}

export function renderComposed(
  overlay: TemplateSource,
  available: readonly TemplateSource[],
  sources: Readonly<Record<string, unknown>>,
): { files: RenderedTemplateFile[]; dropped: string[]; findings: Finding[] } {
  const set = composedBases(overlay.manifest, available);
  if (set.findings.length > 0) return { files: [], dropped: [], findings: set.findings };

  const render = (source: TemplateSource) => ({
    template: source.manifest.name,
    ...renderTemplate(
      source.manifest,
      source.contents,
      slotValues(source.manifest, sources),
      sources,
    ),
  });
  const bases = set.bases.map(render);
  const top = render(overlay);

  const findings = [...bases, top].flatMap((layer) => layer.findings);
  const overlap = overlaps(bases, top);
  if (overlap.length > 0) return { files: [], dropped: [], findings: [...findings, ...overlap] };

  const replaced = new Set(top.files.map((file) => file.path));
  return {
    files: [
      ...bases.flatMap((layer) => layer.files).filter((file) => !replaced.has(file.path)),
      ...top.files,
    ],
    dropped: [...bases, top].flatMap((layer) => layer.dropped),
    findings,
  };
}
