import { mktrueConfigSchema, templateManifestSchema } from "@mktrue/contracts";
import {
  EXIT,
  curatedAfterAdopt,
  derivedValues,
  exitCodeFor,
  importSourcePaths,
  importedAfterAdopt,
  importedAfterWrite,
  planImport,
  slotValues,
  type ExitCode,
} from "@mktrue/core";

import type { FileSystem, Output, ReadOnlyFileSystem } from "../ports.js";
import { columns, clip, errorCode, refuse, row } from "../report.js";

const whatWidth = (): number => columns() - "mktrue: ✗ import · ".length;

const detailWidth = (): number => columns() - "  fix   ".length;

export interface ImportOptions {
  readonly template: string;
  readonly write: boolean;
  readonly adoptTemplate: boolean;
}

export async function runImport(
  fs: FileSystem,
  source: ReadOnlyFileSystem,
  out: Output,
  options: ImportOptions,
): Promise<ExitCode> {
  if (!/^[a-z][a-z0-9-]*$/.test(options.template)) {
    return refuse(
      out,
      "import",
      `"${clip(options.template, 30)}" is not a template name`,
      "the name goes into a path, so a non-slug could leave templates/",
      "pass --template with a slug, such as --template landing",
      EXIT.USAGE,
    );
  }

  const root = `templates/${options.template}`;
  const where = clip(`${root}/template.json`, 40);
  const manifestText = await fs.read(`${root}/template.json`);
  if (manifestText === undefined) {
    return refuse(
      out,
      "import",
      `there is no template called ${clip(options.template, 30)}`,
      "the manifest names the files to lift, and it is not there",
      "run import from the kit repository, and name a template it has",
      EXIT.USAGE,
    );
  }

  let manifest;
  try {
    const parsed = templateManifestSchema.safeParse(JSON.parse(manifestText));
    if (!parsed.success) {
      return refuse(
        out,
        "import",
        clip(
          `${where} did not parse: ${parsed.error.issues[0]?.message ?? "invalid"}`,
          whatWidth(),
        ),
        "the manifest names every path that would be read and written",
        clip(`fix the error named above in ${where}`, detailWidth()),
        EXIT.USAGE,
      );
    }
    manifest = parsed.data;
  } catch (error) {
    return refuse(
      out,
      "import",
      clip(`${where} is not JSON: ${errorCode(error)}`, whatWidth()),
      "the manifest names every path that would be read and written",
      clip(`fix the syntax error in ${where}`, detailWidth()),
      EXIT.USAGE,
    );
  }

  const configText = await source.read(".mktrue.json");
  let configJson: unknown;
  try {
    configJson = JSON.parse(configText ?? "null");
  } catch (error) {
    return refuse(
      out,
      "import",
      clip(`the source's .mktrue.json is not JSON: ${errorCode(error)}`, whatWidth()),
      "the answers it declares are the whole of the tokenisation table",
      "fix the syntax error in the source repository's .mktrue.json",
      EXIT.USAGE,
    );
  }

  const config = mktrueConfigSchema.safeParse(configJson);
  if (!config.success) {
    return refuse(
      out,
      "import",
      clip(
        `the source's .mktrue.json did not parse: ${config.error.issues[0]?.message ?? "invalid"}`,
        whatWidth(),
      ),
      "the answers it declares are the whole of the tokenisation table",
      "run mktrue check in the source repository and fix what it reports",
      EXIT.USAGE,
    );
  }

  const answers = config.data.answers;
  const sources = { answers, derived: derivedValues(answers) };
  const values = slotValues(manifest, sources);

  const sourceContents = new Map<string, string>();
  for (const { sourcePath, safe } of importSourcePaths(manifest, values, sources)) {
    if (!safe) continue;
    const content = await source.read(sourcePath);
    if (content !== undefined) sourceContents.set(sourcePath, content);
  }

  const templateContents = new Map<string, string>();
  for (const file of manifest.files) {
    const content = await fs.read(`${root}/${file.path}`);
    if (content !== undefined) templateContents.set(file.path, content);
  }

  const plan = planImport({
    manifest,
    values,
    sources,
    source: sourceContents,
    template: templateContents,
  });

  const mode = options.write ? "writing" : options.adoptTemplate ? "adopting" : "dry run";
  out.line(`mktrue: import · ${clip(manifest.name, 24)} ← ${clip(answers.name, 24)} · ${mode}`);
  for (const entry of plan.entries) {
    if (entry.action === "unchanged") continue;
    out.line(row(entry.action, entry.path, entry.reason));
  }
  for (const item of plan.reported) {
    out.line(row("reported", item.slot, item.why));
  }
  if (plan.lossyPaths.length > 0) {
    out.line(row("lossy", String(plan.lossyPaths.length), "a declared rewrite fired"));
  }

  for (const finding of plan.findings) out.finding(finding);
  const exit = exitCodeFor(plan.findings);

  if ((options.write || options.adoptTemplate) && plan.refusals.length > 0) {
    return refuse(
      out,
      "import",
      `${plan.refusals.length} refusal(s) · nothing was ${
        options.adoptTemplate ? "recorded" : "written"
      }`,
      "a template is committed and rendered elsewhere, so what gets in gets out",
      "fix what is named above, then import again",
      exit === EXIT.TRUE ? EXIT.FINDINGS : exit,
    );
  }

  if (options.adoptTemplate) {
    if (plan.uncurated.length > 0) {
      return refuse(
        out,
        "import",
        `${plan.uncurated.length} file(s) named here are not in the template`,
        "a hash for a file nobody curated claims a curation that never happened",
        "add the file to the template by hand, or drop it from the manifest",
        EXIT.FINDINGS,
      );
    }

    const raw = JSON.parse(manifestText) as Record<string, unknown>;
    const baseline = importedAfterAdopt(manifest.imported, plan);
    const curated = curatedAfterAdopt(manifest.curated, plan);
    await fs.write(
      `${root}/template.json`,
      `${JSON.stringify({ ...raw, imported: baseline, curated }, null, 2)}\n`,
    );
    out.line(
      `mktrue: adopted · ${clip(manifest.name, 24)} · ${
        Object.keys(baseline).length
      } recorded · no file written`,
    );
  } else if (plan.undecided.length > 0) {
    return refuse(
      out,
      "import",
      `${plan.undecided.length} file(s) have no baseline · nothing was written`,
      "with no baseline every difference reads as a lift, losing the curation",
      "record it: mktrue import --adopt-template --from <dir> --template <n>",
      EXIT.DECISION,
    );
  }

  if (options.write) {
    const staged: { from: string; to: string }[] = [];
    const landed = new Set<string>();

    try {
      for (const entry of plan.entries) {
        if (entry.action !== "lift" || entry.next === undefined) continue;
        const target = `${root}/${entry.path}`;
        const tmp = `${target}.mktrue-staged`;
        await fs.write(tmp, entry.next);
        staged.push({ from: tmp, to: target });
      }
    } catch (error) {
      for (const item of staged) await fs.remove(item.from);
      return refuse(
        out,
        "import",
        "staging failed, so nothing was written",
        "a write failed before anything moved, so the template is untouched",
        clip(
          `${errorCode(error)} on a write: make the template writable, then run import again`,
          detailWidth(),
        ),
        EXIT.FINDINGS,
      );
    }

    for (const item of staged) {
      await fs.rename(item.from, item.to);
      landed.add(item.to.slice(root.length + 1));
    }

    const raw = JSON.parse(manifestText) as Record<string, unknown>;
    const updated = {
      ...raw,
      imported: importedAfterWrite(manifest.imported, plan, landed),
    };
    await fs.write(`${root}/template.json`, `${JSON.stringify(updated, null, 2)}\n`);

    if (landed.size > 0) {
      out.line(`mktrue: note · ${landed.size} file(s) lifted from another repository`);
      out.line("  why   the secret scan is a net, not a proof; it knows some formats, not all");
      out.line("  fix   read the diff before committing it; an import is never auto-committed");
    }
  }

  const { lift, owed, conflict, gone, unchanged } = plan.counts;
  const summary = [
    `${lift} lifted`,
    `${owed} owed`,
    `${conflict} conflict${conflict === 1 ? "" : "s"}`,
    `${gone} gone`,
    `${unchanged} unchanged`,
  ].join(" · ");

  out.line(`mktrue: ${summary}`);
  if (!options.write && !options.adoptTemplate && (lift > 0 || gone > 0)) {
    out.line("mktrue: run with --write to apply");
  }
  if (exit === EXIT.TRUE) out.verdict("mktrue: true · exit 0");
  return exit;
}
