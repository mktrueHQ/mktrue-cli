import { mktrueConfigSchema, type Answers, type MktrueConfig } from "@mktrue/contracts";

import { renderComposed, type TemplateSource } from "./compose.js";
import { derivedValues } from "./derived.js";
import { EXIT, type Finding } from "./findings.js";
import { NO_SIGN_IN, hasSignIn } from "./questions.js";
import type { RenderedFile } from "./render.js";
import { slotsIn, substitute } from "./slots.js";
import { configAfterBench, planBench, renderBenchFor, type BenchSource } from "./sync.js";

export const OFFERED_TEMPLATES: readonly string[] = [
  "application",
  "api-service",
  "landing",
  "infrastructure",
];

export const DEFAULT_REQUIRES: readonly string[] = ["pnpm"];

export const DEFAULT_BUDGETS = { rules: 10000, state: 2500, decision: 12000 } as const;

export const DEFAULT_AUDIT_TRIGGERS: readonly string[] = [
  "auth",
  "routes",
  "mcp",
  "pii",
  "service-worker",
  "config",
  "dependencies",
];

export const CONFIG_PATH = ".mktrue.json";

const CREATED_LOG_DOCUMENT = "created-log";

export interface NewInput {
  readonly template: string;
  readonly name: string;
  readonly answers: Answers;
  readonly templates: readonly TemplateSource[];
  readonly bench: BenchSource;
  readonly date: string;
  readonly kitVersion: string;
  readonly target: string;
}

export interface NewFile extends RenderedFile {
  readonly executable: boolean;
}

export interface PnpmRequirement {
  readonly major: number;
  readonly orNewer: boolean;
}

export interface NewPlan {
  readonly files: readonly NewFile[];
  readonly config: MktrueConfig | undefined;
  readonly gates: readonly string[];
  readonly templateVersion: string;
  readonly pnpm: PnpmRequirement | undefined;
  readonly requires: readonly string[];
  readonly findings: readonly Finding[];
}

/** The tools a template needs, unioned across it and the bases it composes. */
export function requiresFor(template: string, templates: readonly TemplateSource[]): string[] {
  const overlay = templates.find((source) => source.manifest.name === template);
  if (overlay === undefined) return [...DEFAULT_REQUIRES];
  const bases = overlay.manifest.composes.flatMap((base) =>
    templates.filter((source) => source.manifest.name === base).map((s) => s.manifest),
  );
  const union = new Set<string>();
  for (const manifest of [...bases, overlay.manifest]) {
    for (const tool of manifest.requires) union.add(tool);
  }
  return [...union].sort();
}

function oxfordList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function templateNotOfferedFix(): readonly [why: string, fix: string] {
  return [
    `new only offers ${oxfordList(OFFERED_TEMPLATES)}`,
    "see docs/ROADMAP.md for what runs and when",
  ];
}

const finding = (what: string, why: string, fix: string, exit: Finding["exit"]): Finding => ({
  gate: "new",
  what,
  why,
  fix,
  exit,
});

const refused = (findings: Finding[]): NewPlan => ({
  files: [],
  config: undefined,
  gates: [],
  templateVersion: "",
  pnpm: undefined,
  requires: [],
  findings,
});

function valueAt(sources: Readonly<Record<string, unknown>>, path: string): unknown {
  return path.split(".").reduce<unknown>((node, part) => {
    if (node === null || typeof node !== "object" || !Object.hasOwn(node, part)) return undefined;
    return (node as Record<string, unknown>)[part];
  }, sources);
}

export function pnpmRequirement(packageJson: string | undefined): PnpmRequirement | undefined {
  if (packageJson === undefined) return undefined;
  let range: unknown;
  try {
    range = (JSON.parse(packageJson) as { engines?: { pnpm?: unknown } }).engines?.pnpm;
  } catch {
    return undefined;
  }
  if (typeof range !== "string") return undefined;
  const match = /^\s*(>=)?\s*[\^~]?\s*(\d+)/.exec(range);
  if (match === null) return undefined;
  return { major: Number(match[2]), orNewer: match[1] === ">=" };
}

export function pnpmSatisfies(requirement: PnpmRequirement, version: string): boolean {
  const major = /^\s*v?(\d+)\./.exec(version);
  if (major === null) return false;
  const found = Number(major[1]);
  return requirement.orNewer ? found >= requirement.major : found === requirement.major;
}

/** The rules sections a template writes: its own, else the first base that supplies one. */
function sectionBodies(
  overlay: TemplateSource,
  templates: readonly TemplateSource[],
): { bodies: Map<number, string>; findings: Finding[] } {
  const bodies = new Map<number, string>();
  const findings: Finding[] = [];
  const bases = overlay.manifest.composes.flatMap((base) =>
    templates.filter((source) => source.manifest.name === base),
  );
  for (const source of [overlay, ...bases]) {
    for (const [section, path] of Object.entries(source.manifest.rules)) {
      if (bodies.has(Number(section))) continue;
      const body = source.contents.get(path);
      const where = `templates/${source.manifest.name}/${path}`;
      if (body === undefined || body.trim() === "") {
        findings.push(
          finding(
            `${source.manifest.name} names ${path} for rules section ${section}, and it is empty or missing`,
            "the section would render as a heading with nothing under it",
            `write ${where}, or remove it from rules in the manifest`,
            EXIT.FINDINGS,
          ),
        );
        continue;
      }
      if (slotsIn(body).size > 0) {
        findings.push(
          finding(
            `${where} holds a slot`,
            "a rules body a template supplies is rendered as written, so the slot would ship visible",
            `write ${where} without __MKTRUE_ slots`,
            EXIT.FINDINGS,
          ),
        );
        continue;
      }
      if (/<!--\s*mktrue:/.test(body) || /^##\s/m.test(body)) {
        findings.push(
          finding(
            `${where} holds a level-two heading or a mktrue region marker`,
            "it lands inside one section of the rules file, where either would start a section or a region sync then misreads",
            `write ${where} as the text under its heading: no ## line, no <!-- mktrue: marker`,
            EXIT.FINDINGS,
          ),
        );
        continue;
      }
      bodies.set(Number(section), body);
    }
  }
  return { bodies, findings };
}

export function planNew(input: NewInput): NewPlan {
  const { name, template } = input;
  const answers = hasSignIn(template) ? input.answers : { ...input.answers, auth: NO_SIGN_IN };

  if (!OFFERED_TEMPLATES.includes(template)) {
    const [why, fix] = templateNotOfferedFix();
    return refused([finding(`new does not offer the template ${template}`, why, fix, EXIT.USAGE)]);
  }
  if (answers.name !== name) {
    return refused([
      finding(
        `the name ${name} is not the answers' name ${answers.name}`,
        "two sources for one fact would disagree, and one would be rendered",
        `run it as mktrue new ${template} ${answers.name}, or change name in the answers`,
        EXIT.USAGE,
      ),
    ]);
  }

  const overlay = input.templates.find((source) => source.manifest.name === template);
  if (overlay === undefined) {
    return refused([
      finding(
        `the kit carries no template named ${template}`,
        "new offers it, so the kit that was built is missing a part of itself",
        "rebuild mktrue, or report it with the command you ran",
        EXIT.FINDINGS,
      ),
    ]);
  }

  const sources = { answers, derived: derivedValues(answers) };
  const layers = [
    ...overlay.manifest.composes.flatMap((base) =>
      input.templates.filter((source) => source.manifest.name === base).map((s) => s.manifest),
    ),
    overlay.manifest,
    input.bench.manifest,
  ];
  const unanswered = new Map<string, string>();
  for (const manifest of layers) {
    for (const [key, slot] of Object.entries(manifest.slots)) {
      if (!slot.required || !slot.from.startsWith("answers.")) continue;
      if (valueAt(sources, slot.from) === undefined) unanswered.set(slot.from, key);
    }
  }
  if (unanswered.size > 0) {
    return refused(
      [...unanswered].map(([from, key]) =>
        finding(
          `${from} has no answer for __MKTRUE_${key}__`,
          "a slot without a value would ship visible in the rendered repository",
          `add ${from.slice("answers.".length)} to the answers file`,
          EXIT.USAGE,
        ),
      ),
    );
  }

  const composed = renderComposed(overlay, input.templates, sources);
  if (composed.findings.length > 0) return refused(composed.findings);

  const config = mktrueConfigSchema.parse({
    schema: 1,
    kit: input.kitVersion,
    template: { name: template, version: overlay.manifest.version },
    targets: [input.target],
    answers,
    budgets: DEFAULT_BUDGETS,
    auditTriggers: DEFAULT_AUDIT_TRIGGERS,
    gates: overlay.manifest.gates,
    baseBranch: "main",
    pins: [],
    owned: {},
  });

  const sections = sectionBodies(overlay, input.templates);
  if (sections.findings.length > 0) return refused(sections.findings);

  const rendered = renderBenchFor(
    input.bench,
    config,
    input.kitVersion,
    input.target,
    sections.bodies,
  );
  if (rendered.findings.length > 0) return refused([...rendered.findings]);

  const bench = planBench(rendered, config, new Map(), { adopt: true, restore: false });
  const benchFiles: RenderedFile[] = bench.files.entries.flatMap((entry) =>
    entry.action === "update" && entry.next !== undefined
      ? [{ path: entry.path, content: entry.next }]
      : [],
  );
  if (bench.rules.next !== undefined) {
    benchFiles.push({ path: bench.rules.path, content: bench.rules.next });
  }
  const settings = rendered.settings === undefined ? [] : [rendered.settings];
  const stamped = configAfterBench(
    config,
    bench,
    new Set(benchFiles.map((file) => file.path)),
    input.kitVersion,
  );

  const createdValues = new Map(rendered.values)
    .set("TEMPLATE", template)
    .set("TEMPLATE_VERSION", overlay.manifest.version)
    .set("DATE", input.date);
  const seedFindings: Finding[] = [];
  const seeds: RenderedFile[] = [];
  for (const document of input.bench.manifest.docs) {
    const body = input.bench.bodies.get(document.body);
    if (body === undefined) continue;
    const isDirectory = document.renderTo.endsWith("/");
    if (isDirectory && document.id !== CREATED_LOG_DOCUMENT) continue;

    const filled = substitute(body, isDirectory ? createdValues : rendered.values);
    for (const slot of filled.missing) {
      seedFindings.push(
        finding(
          `bench/${document.body} uses __MKTRUE_${slot}__ and no value was supplied`,
          "the seed document would ship with the slot visible",
          `declare ${slot} in bench/bench.json, or remove it from bench/${document.body}`,
          EXIT.FINDINGS,
        ),
      );
    }
    seeds.push(
      isDirectory
        ? { path: `${document.renderTo}${input.date}-created.md`, content: filled.text }
        : { path: document.renderTo, content: filled.text },
    );
  }
  if (seedFindings.length > 0) return refused(seedFindings);

  const configFile = { path: CONFIG_PATH, content: `${JSON.stringify(stamped, null, 2)}\n` };
  const renderedBy = new Map<string, string>();
  const overlaps: Finding[] = [];
  const layered: [string, readonly RenderedFile[]][] = [
    [`the ${template} template`, composed.files],
    ["the bench", [...benchFiles, ...settings]],
    ["the seed documents", seeds],
    ["the configuration", [configFile]],
  ];
  for (const [layer, files] of layered) {
    for (const file of files) {
      const first = renderedBy.get(file.path);
      if (first === undefined) {
        renderedBy.set(file.path, layer);
        continue;
      }
      overlaps.push(
        finding(
          `${file.path} is rendered by both ${first} and ${layer}`,
          "one would overwrite the other, and nothing would say which won",
          "this is a defect in the kit; report it with the command you ran",
          EXIT.FINDINGS,
        ),
      );
    }
  }
  if (overlaps.length > 0) return refused(overlaps);

  return {
    files: [
      ...composed.files.map(({ path, content, executable }) => ({ path, content, executable })),
      ...[...benchFiles, ...settings, ...seeds, configFile].map((file) => ({
        ...file,
        executable: false,
      })),
    ],
    config: stamped,
    gates: overlay.manifest.gates,
    templateVersion: overlay.manifest.version,
    pnpm: pnpmRequirement(composed.files.find((file) => file.path === "package.json")?.content),
    requires: requiresFor(template, input.templates),
    findings: [],
  };
}
