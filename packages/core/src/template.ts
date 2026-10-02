import type { TemplateCondition, TemplateManifest } from "@mktrue/contracts";

import { EXIT, type Finding } from "./findings.js";
import type { RenderedFile } from "./render.js";
import { freeTextSlotKeys, substituteForFile } from "./slots.js";

export interface RenderedTemplateFile extends RenderedFile {
  readonly executable: boolean;
  readonly replaces: boolean;
}

function valueAt(sources: Readonly<Record<string, unknown>>, path: string): unknown {
  return path.split(".").reduce<unknown>((node, part) => {
    if (node === null || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[part];
  }, sources);
}

export function pathRefusal(path: string): string | undefined {
  if (path === "") return "an empty path";
  if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path)) {
    return "a path that is not relative to the repository root";
  }
  if (path.split(/[\\/]/).includes("..")) return "a path that climbs out with ..";
  if (/[\u0000-\u001f]/.test(path)) return "a path with a control character in it";
  return undefined;
}

export function includesFile(
  condition: TemplateCondition | undefined,
  sources: Readonly<Record<string, unknown>>,
): boolean {
  if (condition === undefined) return true;
  const value = valueAt(sources, condition.answer);

  if (condition.absent === true) {
    if (value === undefined || value === null || value === false || value === "") return true;
    return Array.isArray(value) && value.length === 0;
  }
  if (condition.equals !== undefined) return value === condition.equals;
  if (condition.includes !== undefined) {
    return Array.isArray(value) && value.includes(condition.includes);
  }
  return true;
}

export function renderTemplate(
  manifest: TemplateManifest,
  contents: ReadonlyMap<string, string>,
  values: ReadonlyMap<string, string>,
  sources: Readonly<Record<string, unknown>>,
): { files: RenderedTemplateFile[]; dropped: string[]; findings: Finding[] } {
  const findings: Finding[] = [];
  const files: RenderedTemplateFile[] = [];
  const dropped: string[] = [];

  const effective = new Map(values);
  for (const [key, slot] of Object.entries(manifest.slots)) {
    if (!slot.required && !effective.has(key)) effective.set(key, "");
  }
  const freeText = freeTextSlotKeys(manifest.slots);

  for (const file of manifest.files) {
    if (!includesFile(file.when, sources)) {
      dropped.push(file.path);
      continue;
    }

    const body = contents.get(file.path);
    if (body === undefined) {
      findings.push({
        gate: "template",
        what: `${manifest.name} declares ${file.path}, which is not in the template`,
        why: "the manifest and the template have separated; the rendered workspace would be missing a file it says it has",
        fix: `add templates/${manifest.name}/${file.path}, or remove it from the manifest`,
        exit: EXIT.FINDINGS,
      });
      continue;
    }

    if (file.verbatim) {
      files.push({
        path: file.path,
        content: body,
        executable: file.executable,
        replaces: file.replaces,
      });
      continue;
    }

    const renderedPath = substituteForFile(file.path, file.path, effective, freeText);
    const renderedBody = substituteForFile(file.path, body, effective, freeText);

    for (const slot of new Set([...renderedPath.missing, ...renderedBody.missing])) {
      findings.push({
        gate: "template",
        what: `${file.path} uses __MKTRUE_${slot}__ and no value was supplied`,
        why: "the slot is left in place rather than blanked, so the rendered file would ship with it visible",
        fix: `supply ${slot} in the answers, or declare it optional in the template's slots`,
        exit: EXIT.FINDINGS,
      });
    }

    const refusal = pathRefusal(renderedPath.text);
    if (refusal !== undefined) {
      findings.push({
        gate: "template",
        what: `${file.path} renders to ${JSON.stringify(renderedPath.text)}, ${refusal}`,
        why: "an answer substituted into a path decides where the file is written, and this one would land outside the rendered workspace",
        fix: "change the answer that fills this path's slot",
        exit: EXIT.FINDINGS,
      });
      continue;
    }

    files.push({
      path: renderedPath.text,
      content: renderedBody.text,
      executable: file.executable,
      replaces: file.replaces,
    });
  }

  return { files, dropped, findings };
}
