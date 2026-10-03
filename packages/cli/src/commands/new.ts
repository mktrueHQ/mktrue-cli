import { basename } from "node:path";

import { answersSchema, type Answers } from "@mktrue/contracts";
import {
  EXIT,
  OFFERED_TEMPLATES,
  answersFromReplies,
  checkReply,
  exitCodeFor,
  missingTargetFinding,
  planNew,
  pnpmSatisfies,
  questionsFor,
  requiresFor,
  templateNotOfferedFix,
  type ExitCode,
  type Finding,
  type Question,
} from "@mktrue/core";

import { checkEnvironment, environment } from "../environment.js";
import {
  CANCELLED,
  type FileSystem,
  type NewPorts,
  type Output,
  type TemporaryTree,
} from "../ports.js";
import { loadBenchFrom, loadRepo, loadTemplateSources } from "../repo.js";
import { clip, columns, errorCode, printable, refuse } from "../report.js";
import { runCheck } from "./check.js";

export interface NewOptions {
  readonly template: string;
  readonly name: string;
  readonly answers: string | undefined;
  readonly offline: boolean;
  readonly kitVersion: string;
  readonly target: string;
  readonly bench: string | undefined;
}

function report(out: Output, findings: readonly Finding[]): ExitCode {
  for (const finding of findings) out.finding(finding);
  const exit = exitCodeFor(findings);
  out.line(`mktrue: ${findings.length} finding${findings.length === 1 ? "" : "s"} · exit ${exit}`);
  return exit;
}

export function parseAnswers(raw: unknown, source: string, out: Output): Answers | ExitCode {
  const parsed = answersSchema.strict().safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue === undefined || issue.path.length === 0 ? "" : `${issue.path.join(".")}: `;
    return refuse(
      out,
      "usage",
      clip(
        `${printable(source)} · ${where}${issue?.message ?? "invalid"}`,
        columns() - "mktrue: ✗ usage · ".length,
      ),
      "new renders every answer into the repository, so a wrong one would ship",
      "correct the answers; its fields are the answers in .mktrue.json",
      EXIT.USAGE,
    );
  }
  return parsed.data;
}

interface Collected {
  readonly raw: unknown;
  readonly source: string;
}

async function readAnswersFromFile(
  path: string,
  ports: NewPorts,
  out: Output,
): Promise<Collected | ExitCode> {
  const fix = "pass --answers a JSON file holding the answers new renders from";
  let text: string | undefined;
  try {
    text = await ports.workspace.readAnswers(path);
  } catch {
    text = undefined;
  }
  if (text === undefined) {
    return refuse(
      out,
      "usage",
      clip(`cannot read ${printable(path)}`, columns() - "mktrue: ✗ usage · ".length),
      "the answers are all new renders from",
      fix,
      EXIT.USAGE,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return refuse(
      out,
      "usage",
      clip(
        `${printable(path)} is not JSON: ${errorCode(error)}`,
        columns() - "mktrue: ✗ usage · ".length,
      ),
      "the answers are all new renders from",
      fix,
      EXIT.USAGE,
    );
  }
  return { raw, source: path };
}

function nothingWritten(out: Output): ExitCode {
  out.line("mktrue: new · nothing written · exit 0");
  return EXIT.TRUE;
}

async function askAll(
  ports: NewPorts,
  out: Output,
  questions: readonly Question[],
): Promise<Record<string, string> | ExitCode> {
  const replies: Record<string, string> = {};
  for (const question of questions) {
    let attempts = 0;
    for (;;) {
      attempts++;
      const typed = await ports.prompt.ask(question);
      if (typed === CANCELLED) return nothingWritten(out);
      const reply = typed.trim() === "" ? (question.default ?? typed) : typed;
      const error = checkReply(question, reply);
      if (error === undefined) {
        replies[question.key] = reply;
        break;
      }
      out.line(clip(`mktrue: ✗ ${question.label} · ${error}`, columns()));
      if (attempts >= 3) {
        return refuse(
          out,
          "usage",
          clip(
            `${question.label} was never answered · three tries used`,
            columns() - "mktrue: ✗ usage · ".length,
          ),
          "a refused answer would ship, so new stops rather than guessing",
          "run new again, or pass --answers <file>",
          EXIT.USAGE,
        );
      }
    }
  }
  return replies;
}

async function promptForAnswers(
  benchFs: FileSystem | undefined,
  ports: NewPorts,
  out: Output,
  options: NewOptions,
): Promise<Collected | ExitCode> {
  if (!ports.prompt.interactive) {
    return refuse(
      out,
      "usage",
      "no terminal to ask in",
      clip(
        "new asks its questions in a terminal, reading nothing piped in",
        columns() - "  why   ".length,
      ),
      "pass --answers <file>",
      EXIT.USAGE,
    );
  }
  if (!OFFERED_TEMPLATES.includes(options.template)) {
    const [why, fix] = templateNotOfferedFix();
    return refuse(
      out,
      "usage",
      clip(
        `new does not offer the template ${printable(options.template)}`,
        columns() - "mktrue: ✗ usage · ".length,
      ),
      why,
      fix,
      EXIT.USAGE,
    );
  }
  const name = answersSchema.shape.name.safeParse(options.name);
  if (!name.success) {
    return refuse(
      out,
      "usage",
      clip(
        `the name ${printable(options.name)} · ${name.error.issues[0]?.message ?? "invalid"}`,
        columns() - "mktrue: ✗ usage · ".length,
      ),
      "new renders every answer into the repository, so a wrong name would ship",
      "pass a name that is lowercase, digits and hyphens",
      EXIT.USAGE,
    );
  }

  const bench = await loadBenchFrom(benchFs);
  if (bench.findings.length > 0) return report(out, bench.findings);
  if (bench.manifest === undefined) {
    return refuse(
      out,
      "new",
      clip(
        `${options.bench ?? "the embedded copy"} holds no bench/bench.json`,
        columns() - "mktrue: ✗ new · ".length,
      ),
      "the bench is the method; a repository without it is only a template",
      "pass --bench a kit checkout, or drop --bench to use the embedded copy",
      EXIT.FINDINGS,
    );
  }
  const missingTarget = missingTargetFinding(bench.manifest, options.target);
  if (missingTarget !== undefined) return report(out, [missingTarget]);

  const sources = await loadTemplateSources(options.template, benchFs);
  if (sources.findings.length > 0) return report(out, sources.findings);
  const requires = requiresFor(options.template, sources.templates);

  const missingEnv = await checkEnvironment(ports, options.offline, requires);
  if (missingEnv.length > 0) return report(out, missingEnv);
  if ((await ports.workspace.inspect(options.name)) === "occupied") {
    return refuseOccupied(out, options.name)();
  }

  const questions = questionsFor(options.template, options.name);
  out.line(
    clip(
      `mktrue: new · ${options.template} ${options.name} · ${questions.length} questions`,
      columns(),
    ),
  );
  out.line("mktrue: ctrl-c to stop");
  const replies = await askAll(ports, out, questions);
  if (typeof replies === "number") return replies;

  const confirmed = await ports.prompt.confirm("make it?");
  if (confirmed !== true) return nothingWritten(out);

  return { raw: answersFromReplies(options.name, options.template, replies), source: "the prompt" };
}

async function checkPnpmIn(
  tree: TemporaryTree,
  ports: NewPorts,
  pnpm: ReturnType<typeof planNew>["pnpm"],
): Promise<Finding[]> {
  const version = await ports.runner.probe(["pnpm", "--version"], tree);
  if (version === undefined) {
    return [
      environment(
        "pnpm does not run in the rendered tree",
        "the tree's packageManager pin chooses the pnpm the gates would run",
        "install that pnpm, or pass --offline to render without verifying",
      ),
    ];
  }
  if (pnpm !== undefined && !pnpmSatisfies(pnpm, version)) {
    const wanted = `${pnpm.major}${pnpm.orNewer ? " or newer" : ""}`;
    return [
      environment(
        `pnpm ${version} is not pnpm ${wanted}`,
        "the template's lockfile is written for that major version",
        `install pnpm ${wanted}, or pass --offline to render without verifying`,
      ),
    ];
  }
  return [];
}

async function kept(
  out: Output,
  ports: NewPorts,
  tree: TemporaryTree,
  what: string,
  why: string,
  log: boolean,
): Promise<ExitCode> {
  if (!log) await ports.workspace.removeLog(tree);
  out.line(`mktrue: kept · ${tree.name}`);
  if (log) out.line(`mktrue: log · ${tree.log}`);
  return refuse(
    out,
    "new",
    clip(what, columns() - "mktrue: ✗ new · ".length),
    why,
    log
      ? "read the log, fix the cause, delete the kept tree, and run new again"
      : "delete the kept tree and run new again",
    EXIT.FINDINGS,
  );
}

export async function runNew(
  benchFs: FileSystem | undefined,
  ports: NewPorts,
  out: Output,
  options: NewOptions,
): Promise<ExitCode> {
  const collected =
    options.answers === undefined
      ? await promptForAnswers(benchFs, ports, out, options)
      : await readAnswersFromFile(options.answers, ports, out);
  if (typeof collected === "number") return collected;

  const answers = parseAnswers(collected.raw, collected.source, out);
  if (typeof answers === "number") return answers;

  out.line(clip(`mktrue: templates · ${options.bench ?? "embedded"}`, columns()));
  const bench = await loadBenchFrom(benchFs);
  if (bench.findings.length > 0) return report(out, bench.findings);
  if (bench.manifest === undefined) {
    return refuse(
      out,
      "new",
      clip(
        `${options.bench ?? "the embedded copy"} holds no bench/bench.json`,
        columns() - "mktrue: ✗ new · ".length,
      ),
      "the bench is the method; a repository without it is only a template",
      "pass --bench a kit checkout, or drop --bench to use the embedded copy",
      EXIT.FINDINGS,
    );
  }

  const sources = OFFERED_TEMPLATES.includes(options.template)
    ? await loadTemplateSources(options.template, benchFs)
    : { templates: [], findings: [] };
  if (sources.findings.length > 0) return report(out, sources.findings);

  const plan = planNew({
    template: options.template,
    name: options.name,
    answers,
    templates: sources.templates,
    bench: { manifest: bench.manifest, bodies: bench.bodies },
    date: ports.today(),
    kitVersion: options.kitVersion,
    target: options.target,
  });
  if (plan.findings.length > 0) return report(out, plan.findings);

  const missing = await checkEnvironment(ports, options.offline, plan.requires);
  if (missing.length > 0) return report(out, missing);

  const occupied = refuseOccupied(out, options.name);
  if ((await ports.workspace.inspect(options.name)) === "occupied") return occupied();

  let tree: TemporaryTree;
  try {
    tree = await ports.workspace.makeTemporary(options.name);
  } catch (error) {
    const { code, path } = error as NodeJS.ErrnoException;
    if (code !== "EEXIST" || path === undefined) throw error;
    return refuse(
      out,
      "new",
      clip(`${basename(path)} is already there`, columns() - "mktrue: ✗ new · ".length),
      "new makes its log fresh, and never writes through what is already there",
      "remove it, then run new again",
      EXIT.FINDINGS,
    );
  }
  out.line(
    clip(
      `mktrue: new · ${options.template} ${plan.templateVersion} · ${plan.files.length} files · ${tree.name}`,
      columns(),
    ),
  );

  const disarmInterrupt = ports.interrupt.arm(() => {
    out.line(`mktrue: kept · ${tree.name}`);
    out.line(`mktrue: log · ${tree.log}`);
    return EXIT.FINDINGS;
  });
  try {
    try {
      for (const file of plan.files) await tree.fs.write(file.path, file.content, file.executable);
    } catch (error) {
      return kept(
        out,
        ports,
        tree,
        `a write failed: ${errorCode(error)}`,
        "nothing was moved into place",
        false,
      );
    }

    if (!options.offline) {
      if (plan.requires.includes("pnpm")) {
        const unfit = await checkPnpmIn(tree, ports, plan.pnpm);
        if (unfit.length > 0) {
          await ports.workspace.removeTemporary(tree);
          return report(out, unfit);
        }
      }
      for (const gate of plan.gates) {
        const run = await ports.runner.run(gate.split(/\s+/), tree);
        const seconds = run.seconds.toFixed(1);
        out.line(clip(`mktrue: gate · ${gate} · ${run.ok ? "✓" : "✗"} ${seconds}s`, columns()));
        if (!run.ok) {
          return kept(
            out,
            ports,
            tree,
            `${gate} failed, so nothing was committed or moved`,
            "a repository is made true before its first commit, or not made",
            true,
          );
        }
      }
    }

    const checked = await loadRepo(tree.fs, benchFs);
    const exit = runCheck(checked, { ...out, verdict: () => undefined }, options.kitVersion);
    if (exit !== EXIT.TRUE) {
      return kept(
        out,
        ports,
        tree,
        "mktrue check is not true on the rendered tree",
        "new never hands over a repository its own check refuses",
        !options.offline,
      );
    }

    if (!options.offline) {
      const message = `chore: create ${options.name} from mktrue ${options.kitVersion} (${options.template} ${plan.templateVersion})`;
      for (const argv of [
        ["git", "init", "-b", "main"],
        ["git", "add", "-A"],
        ["git", "commit", "-m", message],
      ]) {
        const run = await ports.runner.run(argv, tree);
        if (!run.ok) {
          return kept(
            out,
            ports,
            tree,
            `${argv.slice(0, 2).join(" ")} failed, so nothing was moved`,
            "the repository is handed over committed, or not at all",
            true,
          );
        }
      }
      out.line(clip(`mktrue: git · ${message}`, columns()));
    }

    if ((await ports.workspace.inspect(options.name)) === "occupied") return occupied(tree);
    try {
      await ports.workspace.moveIntoPlace(tree, options.name);
    } catch {
      return occupied(tree);
    }
    await ports.workspace.removeLog(tree);
  } finally {
    disarmInterrupt();
  }

  if (options.offline) {
    out.verdict(clip(`mktrue: ${options.name} rendered · not verified · exit 0`, columns()));
    out.line(clip(`mktrue: next · cd ${options.name}, install, run the gates, commit`, columns()));
  } else {
    out.verdict(clip(`mktrue: ${options.name} is true`, columns()));
    out.line(
      clip(`mktrue: next · cd ${options.name}, then /create-roadmap in your agent`, columns()),
    );
  }
  return EXIT.TRUE;
}

function refuseOccupied(out: Output, name: string): (tree?: TemporaryTree) => ExitCode {
  return (tree) => {
    if (tree !== undefined) out.line(`mktrue: kept · ${tree.name}`);
    return refuse(
      out,
      "new",
      `./${name} already exists and is not an empty directory`,
      "new never writes into, or over, something that is already there",
      tree === undefined
        ? `choose another name, or move ./${name} aside`
        : `move ./${name} aside, then move the kept tree to ./${name}`,
      EXIT.DECISION,
    );
  };
}
