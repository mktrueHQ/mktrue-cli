import {
  benchManifestSchema,
  mktrueConfigSchema,
  templateManifestSchema,
  type BenchManifest,
  type MktrueConfig,
  type TemplateManifest,
} from "@mktrue/contracts";
import { EXIT, type Document, type Finding, type TemplateSource } from "@mktrue/core";

import { EMBEDDED_BENCH } from "./bench.embedded.js";
import type { FileSystem, ReadOnlyFileSystem } from "./ports.js";
import { COLUMNS, clip, errorCode } from "./report.js";
import { EMBEDDED_TEMPLATES } from "./templates.embedded.js";

export interface Repo {
  readonly config: MktrueConfig | undefined;
  readonly rawConfig: Readonly<Record<string, unknown>> | undefined;
  readonly manifest: BenchManifest | undefined;
  readonly bodies: ReadonlyMap<string, string>;
  readonly templates: readonly TemplateManifest[];
  readonly templateSources: readonly TemplateSource[];
  readonly documents: readonly Document[];
  readonly owned: ReadonlyMap<string, string>;
  readonly pathMatches: ReadonlyMap<string, number>;
  readonly findings: readonly Finding[];
}

const parseFailure = (path: string, detail: string): Finding => ({
  gate: "config",
  what: clip(`${path} did not parse: ${detail}`, COLUMNS - "mktrue: ✗ config · ".length),
  why: "every later step reads it, so nothing downstream can be trusted",
  fix: `fix the error named above in ${path}`,
  exit: EXIT.USAGE,
});

const misnamedTemplate = (directory: string, name: string): Finding => ({
  gate: "templates",
  what: `templates/${directory} declares the name ${name}`,
  why: "composes finds a template by its name and the render reads it by its directory, so they would disagree",
  fix: `rename the directory to ${name}, or set name to ${directory}`,
  exit: EXIT.FINDINGS,
});

const isBody = (path: string): boolean => path.endsWith(".md") || path.endsWith(".yml");
const CODE_FILE = /\.(ts|tsx|js|mjs|cjs)$/;

async function benchSourceOf(
  fs: ReadOnlyFileSystem,
  benchFs?: ReadOnlyFileSystem,
): Promise<ReadOnlyFileSystem | undefined> {
  if ((await fs.read("bench/bench.json")) !== undefined) return fs;
  if (benchFs === undefined) return undefined;
  try {
    if ((await benchFs.read("bench/bench.json")) !== undefined) return benchFs;
  } catch {
    return undefined;
  }
  return undefined;
}

export interface Bench {
  readonly manifest: BenchManifest | undefined;
  readonly bodies: ReadonlyMap<string, string>;
  readonly findings: readonly Finding[];
}

export async function loadBench(
  fs: ReadOnlyFileSystem,
  benchFs?: ReadOnlyFileSystem,
): Promise<Bench> {
  return loadBenchFrom(await benchSourceOf(fs, benchFs));
}

export async function loadBenchFrom(benchSource: ReadOnlyFileSystem | undefined): Promise<Bench> {
  const findings: Finding[] = [];
  let manifest: BenchManifest | undefined;
  const bodies = new Map<string, string>();
  const manifestText = benchSource
    ? await benchSource.read("bench/bench.json")
    : EMBEDDED_BENCH["bench.json"];
  if (manifestText !== undefined) {
    try {
      const parsed = benchManifestSchema.safeParse(JSON.parse(manifestText));
      if (parsed.success) {
        manifest = parsed.data;
        if (benchSource !== undefined) {
          for (const path of await benchSource.list("bench")) {
            if (!isBody(path)) continue;
            const content = await benchSource.read(path);
            if (content !== undefined) bodies.set(path.slice("bench/".length), content);
          }
        } else {
          for (const [path, content] of Object.entries(EMBEDDED_BENCH)) {
            if (isBody(path)) bodies.set(path, content);
          }
        }
      } else {
        for (const issue of parsed.error.issues) {
          findings.push(parseFailure("bench/bench.json", issue.message));
        }
      }
    } catch (error) {
      findings.push(parseFailure("bench/bench.json", errorCode(error)));
    }
  }

  return { manifest, bodies, findings };
}

export async function loadTemplateSources(
  template: string,
  source: ReadOnlyFileSystem | undefined,
): Promise<{ templates: TemplateSource[]; findings: Finding[] }> {
  const findings: Finding[] = [];
  const templates: TemplateSource[] = [];
  const read = async (path: string): Promise<string | undefined> =>
    source ? source.read(`templates/${path}`) : EMBEDDED_TEMPLATES[path];

  const load = async (name: string): Promise<TemplateManifest | undefined> => {
    const path = `${name}/template.json`;
    const text = await read(path);
    if (text === undefined) return undefined;
    try {
      const parsed = templateManifestSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        findings.push(
          parseFailure(`templates/${path}`, parsed.error.issues[0]?.message ?? "invalid"),
        );
        return undefined;
      }
      if (parsed.data.name !== name) {
        findings.push(misnamedTemplate(name, parsed.data.name));
        return undefined;
      }
      const contents = new Map<string, string>();
      for (const file of parsed.data.files) {
        const content = await read(`${name}/${file.path}`);
        if (content !== undefined) contents.set(file.path, content);
      }
      templates.push({ manifest: parsed.data, contents });
      return parsed.data;
    } catch (error) {
      findings.push(parseFailure(`templates/${path}`, errorCode(error)));
      return undefined;
    }
  };

  const overlay = await load(template);
  for (const base of overlay?.composes ?? []) await load(base);
  return { templates, findings };
}

export async function loadRepo(fs: FileSystem, benchFs?: FileSystem): Promise<Repo> {
  const findings: Finding[] = [];

  let config: MktrueConfig | undefined;
  let rawConfig: Record<string, unknown> | undefined;
  const configText = await fs.read(".mktrue.json");
  if (configText !== undefined) {
    try {
      const raw: unknown = JSON.parse(configText);
      const parsed = mktrueConfigSchema.safeParse(raw);
      if (parsed.success) {
        config = parsed.data;
        if (raw !== null && typeof raw === "object") rawConfig = raw as Record<string, unknown>;
      } else {
        findings.push(parseFailure(".mktrue.json", parsed.error.issues[0]?.message ?? "invalid"));
      }
    } catch (error) {
      findings.push(parseFailure(".mktrue.json", errorCode(error)));
    }
  }

  const bench = await loadBench(fs, benchFs);
  findings.push(...bench.findings);
  const { manifest, bodies } = bench;

  const templates: TemplateManifest[] = [];
  const templateSources: TemplateSource[] = [];
  for (const path of await fs.list("templates")) {
    if (!/^templates\/[^/]+\/template\.json$/.test(path)) continue;
    const text = await fs.read(path);
    if (text === undefined) continue;
    try {
      const parsed = templateManifestSchema.safeParse(JSON.parse(text));
      if (parsed.success) {
        templates.push(parsed.data);
        const directory = path.split("/")[1] ?? "";
        if (parsed.data.name !== directory) {
          findings.push(misnamedTemplate(directory, parsed.data.name));
        }
        // Only the code files a hostile answer could land in are worth reading here;
        // checkFreeTextTokenPositions is the only reader of this map.
        const contents = new Map<string, string>();
        for (const file of parsed.data.files) {
          if (!CODE_FILE.test(file.path)) continue;
          const content = await fs.read(`templates/${directory}/${file.path}`);
          if (content !== undefined) contents.set(file.path, content);
        }
        templateSources.push({ manifest: parsed.data, contents });
      } else findings.push(parseFailure(path, parsed.error.issues[0]?.message ?? "invalid"));
    } catch (error) {
      findings.push(parseFailure(path, errorCode(error)));
    }
  }

  const documents: Document[] = [];
  const rules = await fs.read("CLAUDE.md");
  if (rules !== undefined) documents.push({ path: "CLAUDE.md", content: rules, kind: "rules" });
  const state = await fs.read("docs/STATE.md");
  if (state !== undefined) documents.push({ path: "docs/STATE.md", content: state, kind: "state" });
  for (const path of await fs.list("docs/decisions")) {
    if (!path.endsWith(".md")) continue;
    const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
    if (name === "index.md" || name === "readme.md") continue;
    const content = await fs.read(path);
    if (content !== undefined) documents.push({ path, content, kind: "decision" });
  }

  const owned = new Map<string, string>();
  for (const path of Object.keys(config?.owned ?? {})) {
    const content = await fs.read(path);
    if (content !== undefined) owned.set(path, content);
  }

  const pathMatches = new Map<string, number>();
  for (const pattern of Object.values(config?.paths ?? {})) {
    if (pattern === "") continue;
    if (pathMatches.has(pattern)) continue;
    if (pattern.endsWith("/")) {
      const listed = await fs.list(pattern.replace(/\/$/, ""));
      pathMatches.set(pattern, listed.length > 0 ? listed.length : 0);
    } else if (pattern.includes("*")) {
      const dir = pattern.slice(0, pattern.lastIndexOf("/"));
      const rest = pattern.slice(pattern.lastIndexOf("/") + 1);
      const re = new RegExp(`^${rest.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
      const listed = await fs.list(dir);
      pathMatches.set(
        pattern,
        listed.filter((f) => re.test(f.slice(f.lastIndexOf("/") + 1))).length,
      );
    } else {
      pathMatches.set(pattern, (await fs.read(pattern)) !== undefined ? 1 : 0);
    }
  }

  return {
    config,
    rawConfig,
    manifest,
    bodies,
    templates,
    templateSources,
    documents,
    owned,
    pathMatches,
    findings,
  };
}
