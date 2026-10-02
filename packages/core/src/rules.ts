import { EXIT, type Finding } from "./findings.js";
import type { RenderedRules } from "./render.js";
import { extractRegion, unterminatedRegion, writeRegion } from "./regions.js";
import { hashContent } from "./stamp.js";

export type RulesAction = "create" | "insert" | "update" | "keep" | "conflict" | "unchanged";

export interface RulesPlan {
  readonly path: string;
  readonly action: RulesAction;
  readonly reason: string;
  readonly next?: string | undefined;
  readonly managedHashes: Readonly<Record<string, string>>;
  readonly findings: readonly Finding[];
}

export interface RulesInput {
  readonly rendered: RenderedRules;
  readonly current: string | undefined;
  readonly managed: Readonly<Record<string, string>>;
  readonly pinned: boolean;
}

export function planRules(input: RulesInput): RulesPlan {
  const { rendered, current, managed } = input;
  const findings: Finding[] = [];
  const hashes: Record<string, string> = { ...managed };

  if (input.pinned) {
    return {
      path: rendered.path,
      action: "keep",
      reason: "pinned in .mktrue.json",
      managedHashes: hashes,
      findings,
    };
  }

  if (current === undefined || current.trim() === "") {
    for (const region of rendered.managed) hashes[region.id] = hashContent(region.content);
    return {
      path: rendered.path,
      action: "create",
      reason: "this repository has no rules file",
      next: rendered.skeleton,
      managedHashes: hashes,
      findings,
    };
  }

  for (const region of rendered.managed) {
    const broken = unterminatedRegion(current, region.id);
    if (broken !== undefined) {
      return {
        path: rendered.path,
        action: "conflict",
        reason: broken.what,
        managedHashes: hashes,
        findings: [broken],
      };
    }
  }

  let next = current;
  let adopted = false;
  let updated = false;

  for (const region of rendered.managed) {
    const onDisk = extractRegion(current, region.id);

    if (onDisk === undefined) {
      next = writeRegion(next, region.id, region.content);
      hashes[region.id] = hashContent(region.content);
      adopted = true;
      continue;
    }

    const recorded = managed[region.id];
    const userChanged = recorded === undefined || hashContent(onDisk) !== recorded;
    const kitChanged = recorded === undefined || hashContent(region.content) !== recorded;

    if (!userChanged && kitChanged) {
      next = writeRegion(next, region.id, region.content);
      hashes[region.id] = hashContent(region.content);
      updated = true;
    } else if (userChanged && kitChanged && hashContent(onDisk) !== hashContent(region.content)) {
      findings.push({
        gate: "sync",
        what: `the mktrue:${region.id} region of ${rendered.path} changed in both the kit and this repository`,
        why: "overwriting would discard your edit; skipping would leave the method behind",
        fix: `edit the region between the mktrue:${region.id} markers, or move your text outside them to make it yours`,
        exit: EXIT.DECISION,
      });
      return {
        path: rendered.path,
        action: "conflict",
        reason: "both changed inside the kit's region",
        managedHashes: hashes,
        findings,
      };
    } else if (!userChanged && !kitChanged) {
      // Same content, rewritten anyway: the framing around it can change between kits.
      next = writeRegion(next, region.id, region.content);
      hashes[region.id] = hashContent(region.content);
    }
  }

  if (adopted) {
    return {
      path: rendered.path,
      action: "insert",
      reason: "the kit's section added; the rest of your rules untouched",
      next,
      managedHashes: hashes,
      findings,
    };
  }
  if (updated) {
    return {
      path: rendered.path,
      action: "update",
      reason: "the kit's section changed, yours did not",
      next,
      managedHashes: hashes,
      findings,
    };
  }
  if (next !== current) {
    return {
      path: rendered.path,
      action: "update",
      reason: "the kit's section is the same; its framing is not",
      next,
      managedHashes: hashes,
      findings,
    };
  }
  return {
    path: rendered.path,
    action: "unchanged",
    reason: "the kit's section is already what it should be",
    managedHashes: hashes,
    findings,
  };
}
