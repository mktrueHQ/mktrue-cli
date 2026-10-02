import { declaresAnswer, type BenchManifest, type TemplateManifest } from "@mktrue/contracts";

import { EXIT, type Finding } from "./findings.js";
import { freeTextSlotKeys, slotsIn } from "./slots.js";

export interface BenchEntry {
  readonly name: string;
  readonly body: string;
  readonly slots: readonly string[];
  readonly description?: string | undefined;
}

export function benchEntries(manifest: BenchManifest): BenchEntry[] {
  return [
    ...manifest.roles.map((r) => ({
      name: `role ${r.id}`,
      body: r.body,
      slots: r.slots,
      description: r.description,
    })),
    ...manifest.contracts.map((c) => ({ name: `contract ${c.id}`, body: c.body, slots: c.slots })),
    ...manifest.commands.map((c) => ({ name: `command ${c.id}`, body: c.body, slots: c.slots })),
    ...manifest.workflows.map((w) => ({ name: `workflow ${w.id}`, body: w.body, slots: w.slots })),
    ...manifest.rules.map((r) => ({
      name: `rules section ${r.section}`,
      body: r.body,
      slots: r.slots,
    })),
    ...manifest.docs.map((d) => ({ name: `document ${d.id}`, body: d.body, slots: d.slots })),
  ];
}

export function checkBenchIntegrity(
  manifest: BenchManifest,
  bodies: ReadonlyMap<string, string>,
): { findings: Finding[]; declaredSlots: number; entries: number } {
  const findings: Finding[] = [];
  const declared = new Set(Object.keys(manifest.slots));
  const used = new Set<string>();
  const entries = benchEntries(manifest);

  for (const entry of entries) {
    const content = bodies.get(entry.body);
    if (content === undefined) {
      findings.push({
        gate: "bench",
        what: `${entry.body} is declared by ${entry.name} but does not exist`,
        why: "the manifest and the prose have separated; a render would write an empty file",
        fix: `create bench/${entry.body}, or remove ${entry.name} from bench/bench.json`,
        exit: EXIT.FINDINGS,
      });
      continue;
    }

    const found = slotsIn([content, entry.description ?? ""].join("\n"));
    for (const slot of found) used.add(slot);

    const stated = new Set(entry.slots);
    for (const slot of found) {
      if (!stated.has(slot)) {
        findings.push({
          gate: "bench",
          what: `${entry.name} uses __MKTRUE_${slot}__ without declaring it (${entry.body})`,
          why: "the renderer fills only declared slots; this one would ship unsubstituted",
          fix: `add "${slot}" to the slots of ${entry.name} in bench/bench.json`,
          exit: EXIT.FINDINGS,
        });
      }
    }
    for (const slot of stated) {
      if (!found.has(slot)) {
        findings.push({
          gate: "bench",
          what: `${entry.name} declares ${slot} but never uses it (${entry.body})`,
          why: "a declared slot that is never filled hides a rename or a deleted paragraph",
          fix: `remove "${slot}" from ${entry.name}, or use __MKTRUE_${slot}__ in bench/${entry.body}`,
          exit: EXIT.FINDINGS,
        });
      }
    }
  }

  for (const target of Object.values(manifest.targets)) {
    for (const value of [target.roles, target.commands, target.rules, target.settings]) {
      for (const slot of slotsIn(value)) used.add(slot);
    }
  }

  for (const slot of used) {
    if (!declared.has(slot)) {
      findings.push({
        gate: "bench",
        what: `__MKTRUE_${slot}__ is used but not declared in slots`,
        why: "the renderer has no source for it, so it would render literally into a file",
        fix: `declare "${slot}" under slots in bench/bench.json, with the answer it comes from`,
        exit: EXIT.FINDINGS,
      });
    }
  }
  for (const slot of declared) {
    if (!used.has(slot)) {
      findings.push({
        gate: "bench",
        what: `slot ${slot} is declared but used nowhere`,
        why: "an unused slot is usually the remains of a paragraph that was rewritten",
        fix: `remove "${slot}" from slots in bench/bench.json, or use it`,
        exit: EXIT.FINDINGS,
      });
    }
  }

  return { findings, declaredSlots: declared.size, entries: entries.length };
}

export interface SlotTable {
  readonly name: string;
  readonly slots: TemplateManifest["slots"];
}

export function checkTemplateSlots(templates: readonly SlotTable[]): {
  findings: Finding[];
  templates: number;
  answerSlots: number;
} {
  const findings: Finding[] = [];
  let answerSlots = 0;

  for (const template of templates) {
    for (const [key, slot] of Object.entries(template.slots)) {
      if (!slot.from.startsWith("answers.")) continue;
      answerSlots += 1;
      const field = slot.from.slice("answers.".length);
      if (declaresAnswer(field)) continue;
      findings.push({
        gate: "templates",
        what: `${template.name} takes ${key} from ${slot.from}, which is not an answer`,
        why: "the slot resolves to nothing, so the file renders with __MKTRUE_ still in it — or renders only because something supplied the value by hand",
        fix: `add ${field} to answersSchema in packages/contracts/src/config.ts, or point ${key} at an answer that exists`,
        exit: EXIT.FINDINGS,
      });
    }
  }

  return { findings, templates: templates.length, answerSlots };
}

export function checkGeneratedLockfiles(
  templates: readonly TemplateManifest[],
  offered: readonly string[],
): { findings: Finding[]; lockfiles: number } {
  const findings: Finding[] = [];
  let lockfiles = 0;

  for (const template of templates) {
    if (!offered.includes(template.name)) continue;
    for (const file of template.files) {
      if (file.path !== "pnpm-lock.yaml" && !file.path.endsWith("/pnpm-lock.yaml")) continue;
      lockfiles += 1;
      if (file.generated) continue;
      findings.push({
        gate: "templates",
        what: `${template.name} ships ${file.path} without generated: true`,
        why: "import would lift a product's lockfile into the template (decision 0016)",
        fix: `mark it "generated": true in templates/${template.name}/template.json`,
        exit: EXIT.FINDINGS,
      });
    }
  }

  return { findings, lockfiles };
}

const CODE_FILE = /\.(ts|tsx|js|mjs|cjs)$/;
const COMMENT_EVENT = /\/\*|\*\//g;
const BACKTICK_EVENT = /(?<!\\)`/g;

/** Line-based; see docs/architecture.md for exactly what this scan does and does not catch. */
export function checkFreeTextTokenPositions(
  templates: readonly {
    readonly manifest: TemplateManifest;
    readonly contents: ReadonlyMap<string, string>;
  }[],
): { findings: Finding[]; checked: number } {
  const findings: Finding[] = [];
  let checked = 0;

  for (const { manifest, contents } of templates) {
    const freeText = freeTextSlotKeys(manifest.slots);
    if (freeText.size === 0) continue;
    const pattern = new RegExp(`__MKTRUE_(${[...freeText].join("|")})__`, "g");

    for (const [path, content] of contents) {
      if (!CODE_FILE.test(path)) continue;
      checked += 1;

      let inComment = false;
      let inTemplateLiteral = false;
      for (const [lineIndex, line] of content.split("\n").entries()) {
        const trimmed = line.trimStart();
        const startedInComment = inComment;
        const startedInTemplateLiteral = inTemplateLiteral;
        const commentEvents = [...line.matchAll(COMMENT_EVENT)].map((m) => ({
          index: m.index,
          open: m[0] === "/*",
        }));
        const backtickIndices = [...line.matchAll(BACKTICK_EVENT)].map((m) => m.index);

        pattern.lastIndex = 0;
        for (const match of line.matchAll(pattern)) {
          const at = match.index;
          let commentedHere = startedInComment;
          for (const event of commentEvents) {
            if (event.index > at) break;
            commentedHere = event.open;
          }
          if (commentedHere || trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

          let templatedHere = startedInTemplateLiteral;
          for (const index of backtickIndices) {
            if (index > at) break;
            templatedHere = !templatedHere;
          }
          if (templatedHere) continue;

          const before = line.slice(0, at);
          const quotedThisLine = (['"', "'"] as const).some((q) => {
            const opens = before.split("").filter((c) => c === q).length;
            return opens % 2 === 1;
          });
          if (quotedThisLine) continue;

          findings.push({
            gate: "templates",
            what: `${manifest.name}/${path}:${lineIndex + 1} uses __MKTRUE_${match[1]}__ outside a string literal or a comment`,
            why: "escaping makes a founder's answer safe inside a string or a comment; outside either it becomes code",
            fix: `move __MKTRUE_${match[1]}__ into a string literal in templates/${manifest.name}/${path}`,
            exit: EXIT.FINDINGS,
          });
        }

        for (const event of commentEvents) inComment = event.open;
        if (backtickIndices.length % 2 === 1) inTemplateLiteral = !inTemplateLiteral;
      }
    }
  }

  return { findings, checked };
}
