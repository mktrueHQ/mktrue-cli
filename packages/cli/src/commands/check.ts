import {
  DEFAULT_BUDGETS,
  EXIT,
  OFFERED_TEMPLATES,
  characterCount,
  checkBenchIntegrity,
  checkBudgets,
  checkComposition,
  checkDocumentPaths,
  checkDrift,
  checkFreeTextTokenPositions,
  checkGeneratedLockfiles,
  checkTemplateSlots,
  checkTiers,
  exitCodeFor,
  type ExitCode,
  type Finding,
} from "@mktrue/core";

import type { Output } from "../ports.js";
import type { Repo } from "../repo.js";
import { COLUMNS, clip } from "../report.js";

const number = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export interface GateRun {
  readonly findings: readonly Finding[];
  readonly lines: readonly string[];
  readonly run: number;
  readonly passed: number;
}

export function runGates(repo: Repo, kitVersion: string): GateRun {
  const findings: Finding[] = [...repo.findings];
  const lines: string[] = [];
  let gatesRun = 0;
  let gatesPassed = 0;

  const gate = <T>(
    label: string,
    run: () => { findings: Finding[] } & T,
    facts: (r: T) => string | readonly string[],
  ) => {
    gatesRun += 1;
    const before = findings.length;
    const result = run();
    findings.push(...result.findings);
    if (findings.length === before) gatesPassed += 1;
    const told = facts(result);
    for (const fact of typeof told === "string" ? [told] : told) {
      lines.push(clip(`mktrue: ${label} · ${fact}`, COLUMNS));
    }
  };

  const budgets = repo.config?.budgets ?? DEFAULT_BUDGETS;

  gate(
    "budgets",
    () => checkBudgets(repo.documents, budgets),
    () => {
      const of = (path: string) => repo.documents.find((d) => d.path === path);
      const rules = of("CLAUDE.md");
      const state = of("docs/STATE.md");
      const decisions = repo.documents.filter((d) => d.kind === "decision");
      const largest = decisions.reduce((max, d) => Math.max(max, characterCount(d.content)), 0);
      const parts: string[] = [];
      if (rules)
        parts.push(`rules ${number(characterCount(rules.content))} / ${number(budgets.rules)}`);
      if (state)
        parts.push(`state ${number(characterCount(state.content))} / ${number(budgets.state)}`);
      return [
        parts.join(" · "),
        `decisions ${decisions.length} · largest ${number(largest)} / ${number(budgets.decision)}`,
      ].filter((line) => line !== "");
    },
  );

  if (repo.manifest !== undefined) {
    const manifest = repo.manifest;
    gate(
      "bench",
      () => checkBenchIntegrity(manifest, repo.bodies),
      (r) => `${r.entries} entries · ${r.declaredSlots} slots`,
    );
    gate(
      "tiers",
      () => checkTiers(manifest),
      (r) => `${manifest.roles.length} roles · ${r.tiered} tiered`,
    );
  }

  if (repo.templates.length > 0) {
    const templates = repo.templates;
    gate(
      "templates",
      () => {
        const slots = checkTemplateSlots(templates);
        const composition = checkComposition(templates);
        const lockfiles = checkGeneratedLockfiles(templates, OFFERED_TEMPLATES);
        const tokenPositions = checkFreeTextTokenPositions(repo.templateSources);
        return {
          ...slots,
          ...composition,
          ...lockfiles,
          findings: [
            ...slots.findings,
            ...composition.findings,
            ...lockfiles.findings,
            ...tokenPositions.findings,
          ],
        };
      },
      (r) => [
        `${r.templates} templates · ${r.answerSlots} answer slots · ${r.composites} composed · ${r.replaces.length} replaces`,
        ...r.replaces.map((replace) => `${replace.template} replaces ${replace.path}`),
      ],
    );
  }

  if (repo.config !== undefined) {
    const config = repo.config;
    gate(
      "paths",
      () => checkDocumentPaths(config.paths, repo.pathMatches),
      (r) => `${r.resolved} of ${r.total} resolve`,
    );
    gate(
      "drift",
      () =>
        checkDrift({
          owned: config.owned,
          pins: config.pins,
          current: repo.owned,
          repoKitVersion: config.kit,
          kitVersion,
        }),
      (r) => {
        const total = Object.keys(config.owned).length;
        return `${total} owned · ${r.edited} edited · ${config.pins.length} pinned`;
      },
    );
  }

  return { findings, lines, run: gatesRun, passed: gatesPassed };
}

export function printGates(gates: GateRun, out: Output): void {
  out.line(
    `mktrue: check · ${gates.passed} of ${gates.run} ${gates.passed === gates.run ? "✓" : "✗"}`,
  );
  for (const line of gates.lines) out.line(line);
  for (const finding of gates.findings) out.finding(finding);
}

export function printVerdict(count: number, exit: ExitCode, out: Output): ExitCode {
  if (exit === EXIT.TRUE) {
    out.verdict("mktrue: true · exit 0");
    return EXIT.TRUE;
  }
  out.line(`mktrue: ${count} finding${count === 1 ? "" : "s"} · exit ${exit}`);
  return exit;
}

export function runCheck(repo: Repo, out: Output, kitVersion: string): ExitCode {
  const gates = runGates(repo, kitVersion);
  printGates(gates, out);
  return printVerdict(gates.findings.length, exitCodeFor(gates.findings), out);
}
