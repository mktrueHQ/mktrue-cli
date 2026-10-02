import type { MktrueConfig, PlanCounts, SiblingCode, SiblingRow } from "@mktrue/contracts";

import { checkDrift } from "./drift.js";
import { EXIT, exitCodeFor, type ExitCode, type Finding } from "./findings.js";
import { planBench, renderBenchFor, type BenchSource } from "./sync.js";

export type PlanStepAction = keyof PlanCounts;

export interface PlanStep {
  readonly path: string;
  readonly action: PlanStepAction;
}

export interface RepositoryState {
  readonly kit: string;
  readonly owned: Readonly<Record<string, string>>;
  readonly pins: readonly string[];
  readonly edited: number;
  readonly plan: readonly PlanStep[];
}

export interface DescribeInput {
  readonly config: MktrueConfig;
  readonly current: ReadonlyMap<string, string>;
  readonly bench: BenchSource;
  readonly kitVersion: string;
  readonly target: string;
}

export function pathsToRead(input: Omit<DescribeInput, "current">): readonly string[] {
  const rendered = renderBenchFor(input.bench, input.config, input.kitVersion, input.target);
  return [
    ...new Set([
      ...Object.keys(input.config.owned),
      ...rendered.files.map((file) => file.path),
      rendered.rules.path,
    ]),
  ];
}

export function describeRepository(
  input: DescribeInput,
): { state: RepositoryState; findings: readonly Finding[] } | { findings: readonly Finding[] } {
  const { config, current } = input;
  const rendered = renderBenchFor(input.bench, config, input.kitVersion, input.target);
  if (rendered.findings.length > 0) return { findings: rendered.findings };

  const { edited } = checkDrift({
    owned: config.owned,
    pins: config.pins,
    current,
    repoKitVersion: config.kit,
    kitVersion: input.kitVersion,
  });
  const bench = planBench(rendered, config, current, { adopt: false, restore: false });

  const plan: PlanStep[] = [];
  for (const entry of bench.files.entries) {
    if (entry.action === "update") {
      plan.push({ path: entry.path, action: entry.path in config.owned ? "update" : "new" });
    } else if (entry.action === "conflict" || entry.action === "removed") {
      plan.push({ path: entry.path, action: entry.action });
    }
  }
  const rules = bench.rules;
  if (rules.action === "create") plan.push({ path: rules.path, action: "new" });
  if (rules.action === "insert" || rules.action === "update") {
    plan.push({ path: rules.path, action: "update" });
  }
  if (rules.action === "conflict") plan.push({ path: rules.path, action: "conflict" });

  return {
    state: { kit: config.kit, owned: config.owned, pins: config.pins, edited, plan },
    findings: [],
  };
}

export type SiblingInput =
  | {
      readonly entry: number;
      readonly path: string;
      readonly readable: true;
      readonly ref: string;
      readonly commit: string;
      readonly listsBack: boolean;
      readonly state: RepositoryState;
    }
  | {
      readonly entry: number;
      readonly path: string | null;
      readonly readable: false;
      readonly why: string;
      readonly refused?: true;
    };

export interface SiblingFinding extends Finding {
  readonly code: SiblingCode;
  readonly entry: number;
  readonly path: string | null;
}

export interface SiblingComparison {
  readonly rows: readonly SiblingRow[];
  readonly findings: readonly SiblingFinding[];
  readonly diverging: number;
  readonly exit: ExitCode;
}

export function planCounts(plan: readonly PlanStep[]): PlanCounts {
  const counts = { update: 0, conflict: 0, removed: 0, new: 0 };
  for (const step of plan) counts[step.action] += 1;
  return counts;
}

const planKey = (plan: readonly PlanStep[]): string =>
  plan
    .map((step) => `${step.action} ${step.path}`)
    .sort()
    .join("\n");

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((item) => right.has(item));
};

export function shownSibling(entry: number, path: string | null): string {
  return path ?? `answers.siblings[${entry}]`;
}

export function compareSiblings(
  self: RepositoryState,
  siblings: readonly SiblingInput[],
): SiblingComparison {
  const rows: SiblingRow[] = [];
  const findings: SiblingFinding[] = [];
  let diverging = 0;

  for (const sibling of siblings) {
    const shown = shownSibling(sibling.entry, sibling.path);
    const found = (
      code: SiblingCode,
      what: string,
      why: string,
      fix: string,
      exit: ExitCode = EXIT.FINDINGS,
    ): SiblingFinding => ({
      gate: code,
      code,
      entry: sibling.entry,
      path: sibling.path,
      what,
      why,
      fix,
      exit,
    });

    if (!sibling.readable) {
      rows.push({ entry: sibling.entry, path: sibling.path, readable: false, why: sibling.why });
      findings.push(
        sibling.refused === true
          ? found(
              "sibling-unreadable",
              `${shown} is refused`,
              "a sibling sits beside this repository",
              "list it as ../<name>",
              EXIT.ENVIRONMENT,
            )
          : found(
              "sibling-unreadable",
              `${shown} could not be read: ${sibling.why}`,
              "a listed sibling that cannot be read cannot be compared",
              sibling.path === null
                ? `name it relative to this repository, or remove it from answers.siblings`
                : `clone it at ${sibling.path}, or remove it from answers.siblings`,
              EXIT.ENVIRONMENT,
            ),
      );
      continue;
    }

    const { state } = sibling;
    rows.push({
      entry: sibling.entry,
      path: sibling.path,
      readable: true,
      ref: sibling.ref,
      commit: sibling.commit,
      listsBack: sibling.listsBack,
      kit: state.kit,
      owned: Object.keys(state.owned).length,
      edited: state.edited,
      pinned: state.pins.length,
      plan: planCounts(state.plan),
    });

    const before = findings.length;
    if (state.kit !== self.kit) {
      findings.push(
        found(
          "sibling-kit",
          `${shown} records kit ${state.kit}; this repository records ${self.kit}`,
          "the two were last synced from different kits",
          "run `mktrue sync --write` in both, from the same kit",
        ),
      );
    }
    if (planKey(state.plan) !== planKey(self.plan)) {
      findings.push(
        found(
          "sibling-behind",
          `the kit's plan for ${shown} differs from this repository's`,
          "one of them has not taken the same bench changes, so the methods differ",
          `run \`mktrue sync\` in both, then \`mktrue sync --write\` where it is behind`,
        ),
      );
    }
    if (!sameSet(Object.keys(state.owned), Object.keys(self.owned))) {
      findings.push(
        found(
          "sibling-owned",
          `${shown} owns a different set of kit files from this repository`,
          "a role or a command exists in one of them and not in the other",
          "run `mktrue sync --write` in the one missing files, or drop the extra",
        ),
      );
    }
    if (state.edited > 0) {
      findings.push(
        found(
          "sibling-edited",
          `${shown} has ${state.edited} kit-owned file${state.edited === 1 ? "" : "s"} edited`,
          "an edited file stops following the kit and nothing records why",
          `run \`mktrue check\` in ${shown}, then pin or revert each one`,
        ),
      );
    }
    if (!sameSet(state.pins, self.pins)) {
      findings.push(
        found(
          "sibling-pinned",
          `${shown} pins different files from this repository`,
          "a pinned file stops following the kit, so the method splits there",
          "pin the same files in both, or drop the pin",
        ),
      );
    }
    if (findings.length > before) diverging += 1;
    if (!sibling.listsBack) {
      findings.push(
        found(
          "sibling-one-way",
          `${shown} does not list this repository in answers.siblings`,
          "check --siblings run there will not see this repository",
          `add this repository to answers.siblings in ${shown}`,
          EXIT.TRUE,
        ),
      );
    }
  }

  return { rows, findings, diverging, exit: exitCodeFor(findings) };
}
