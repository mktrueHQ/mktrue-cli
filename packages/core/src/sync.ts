import type { BenchManifest, MktrueConfig } from "@mktrue/contracts";

import { EXIT, type Finding } from "./findings.js";
import { renderBench, type RenderedFile, type RenderedRules } from "./render.js";
import { planRules, type RulesPlan } from "./rules.js";
import { slotValues } from "./slots.js";
import { hashContent } from "./stamp.js";

export type SyncAction = "update" | "keep" | "conflict" | "skip" | "removed" | "unchanged";

export interface SyncEntry {
  readonly path: string;
  readonly action: SyncAction;
  readonly reason: string;
  readonly next?: string | undefined;
}

export interface SyncInput {
  readonly owned: Readonly<Record<string, string>>;
  readonly pins: readonly string[];
  readonly current: ReadonlyMap<string, string>;
  readonly next: ReadonlyMap<string, string>;
  readonly adopt?: boolean | undefined;
  readonly restore?: boolean | undefined;
}

export interface SyncPlan {
  readonly entries: readonly SyncEntry[];
  readonly findings: readonly Finding[];
  readonly counts: Readonly<Record<SyncAction, number>>;
}

function normalisePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/$/, "");
}

export function planSync(input: SyncInput): SyncPlan {
  const entries: SyncEntry[] = [];
  const findings: Finding[] = [];
  const pinned = new Set(input.pins.map(normalisePath));

  const paths = [...new Set([...input.next.keys(), ...Object.keys(input.owned)])].sort();

  for (const path of paths) {
    if (pinned.has(normalisePath(path))) {
      entries.push({ path, action: "skip", reason: "pinned in .mktrue.json" });
      continue;
    }

    const next = input.next.get(path);
    const onDisk = input.current.get(path);
    const recorded = input.owned[path];

    if (onDisk === undefined) {
      if (recorded !== undefined) {
        if (input.restore === true && next !== undefined) {
          entries.push({ path, action: "update", reason: "restored at your request", next });
        } else {
          entries.push({
            path,
            action: "removed",
            reason: "removed by you; sync will not recreate it without --restore",
          });
        }
      } else if (next !== undefined) {
        entries.push({ path, action: "update", reason: "new in the kit", next });
      }
      continue;
    }

    if (next === undefined) {
      entries.push({ path, action: "keep", reason: "the kit no longer ships this file" });
      continue;
    }

    const userChanged = recorded === undefined || hashContent(onDisk) !== recorded;
    const kitChanged = recorded === undefined || hashContent(next) !== recorded;

    if (!userChanged && kitChanged) {
      entries.push({ path, action: "update", reason: "kit changed, yours did not", next });
    } else if (userChanged && !kitChanged) {
      entries.push({ path, action: "keep", reason: "you changed it, the kit did not" });
    } else if (userChanged && kitChanged) {
      if (input.adopt === true && recorded === undefined) {
        entries.push({
          path,
          action: "update",
          reason: "adopted: the kit's version replaces yours",
          next,
        });
      } else if (hashContent(onDisk) === hashContent(next)) {
        entries.push({ path, action: "unchanged", reason: "both changed to the same content" });
      } else {
        entries.push({
          path,
          action: "conflict",
          reason: "both changed · the kit's version is saved next to it",
          next,
        });
        findings.push({
          gate: "sync",
          what: `${path} changed in both the kit and this repository`,
          why: "overwriting would discard your edit; skipping would leave the method behind",
          fix: `compare ${path} with ${path}.mktrue-next, keep what is right, then delete the .mktrue-next file`,
          exit: EXIT.DECISION,
        });
      }
    } else {
      entries.push({ path, action: "unchanged", reason: "identical on both sides" });
    }
  }

  const counts: Record<SyncAction, number> = {
    update: 0,
    keep: 0,
    conflict: 0,
    skip: 0,
    removed: 0,
    unchanged: 0,
  };
  for (const entry of entries) counts[entry.action] += 1;

  return { entries, findings, counts };
}

export function ownedAfterSync(
  owned: Readonly<Record<string, string>>,
  plan: SyncPlan,
  landed?: ReadonlySet<string>,
): Record<string, string> {
  const updated: Record<string, string> = { ...owned };
  for (const entry of plan.entries) {
    if (entry.action !== "update" || entry.next === undefined) continue;
    if (landed !== undefined && !landed.has(entry.path)) continue;
    updated[entry.path] = hashContent(entry.next);
  }
  return updated;
}

export interface BenchSource {
  readonly manifest: BenchManifest;
  readonly bodies: ReadonlyMap<string, string>;
}

export interface BenchRender {
  readonly files: readonly RenderedFile[];
  readonly rules: RenderedRules;
  readonly values: ReadonlyMap<string, string>;
  readonly findings: readonly Finding[];
}

export function renderBenchFor(
  bench: BenchSource,
  config: MktrueConfig,
  kitVersion: string,
  target: string,
): BenchRender {
  const values = slotValues(bench.manifest, {
    answers: config.answers,
    config: {
      auditTriggers: config.auditTriggers,
      baseBranch: config.baseBranch,
      budgets: config.budgets,
      paths: config.paths,
    },
    derived: { gates: config.gates ?? [], kitVersion },
  });
  return { ...renderBench(bench.manifest, bench.bodies, values, target), values };
}

export interface BenchPlan {
  readonly files: SyncPlan;
  readonly rules: RulesPlan;
}

export function planBench(
  rendered: BenchRender,
  config: MktrueConfig,
  current: ReadonlyMap<string, string>,
  options: { readonly adopt: boolean; readonly restore: boolean },
): BenchPlan {
  return {
    files: planSync({
      owned: config.owned,
      pins: config.pins,
      current,
      next: new Map(rendered.files.map((file) => [file.path, file.content] as const)),
      adopt: options.adopt,
      restore: options.restore,
    }),
    rules: planRules({
      rendered: rendered.rules,
      current: current.get(rendered.rules.path),
      managed: config.managed[rendered.rules.path] ?? {},
      pinned: config.pins.includes(rendered.rules.path),
    }),
  };
}

export function configAfterBench(
  config: MktrueConfig,
  plan: BenchPlan,
  landed: ReadonlySet<string>,
  kitVersion: string,
): MktrueConfig {
  return {
    ...config,
    kit: kitVersion,
    owned: ownedAfterSync(config.owned, plan.files, landed),
    managed: landed.has(plan.rules.path)
      ? { ...config.managed, [plan.rules.path]: plan.rules.managedHashes }
      : config.managed,
  };
}
