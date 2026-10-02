import { EXIT, type Finding } from "./findings.js";
import { hashContent } from "./stamp.js";

export interface DriftInput {
  readonly owned: Readonly<Record<string, string>>;
  readonly pins: readonly string[];
  readonly current: ReadonlyMap<string, string>;
  readonly repoKitVersion: string;
  readonly kitVersion: string;
}

export function checkDrift(input: DriftInput): { findings: Finding[]; edited: number } {
  const findings: Finding[] = [];
  const pinned = new Set(input.pins);
  let edited = 0;

  for (const [path, recorded] of Object.entries(input.owned)) {
    if (pinned.has(path)) continue;

    const content = input.current.get(path);
    if (content === undefined) {
      findings.push({
        gate: "drift",
        what: `${path} is owned by the kit and has been removed`,
        why: "sync will not recreate it, so the method is missing a part and nothing says so",
        fix: `restore it with \`mktrue sync --write --restore\`, or pin it in .mktrue.json to say the removal was deliberate`,
        exit: EXIT.FINDINGS,
      });
      continue;
    }

    if (hashContent(content) !== recorded) {
      edited += 1;
      findings.push({
        gate: "drift",
        what: `${path} was edited after the kit wrote it`,
        why: "the next sync sees it as yours and will stop updating it, so the method quietly stops improving here",
        fix: `pin it in .mktrue.json to keep your version, or revert it and put the change in a repository-owned file`,
        exit: EXIT.FINDINGS,
      });
    }
  }

  if (input.repoKitVersion !== input.kitVersion) {
    findings.push({
      gate: "drift",
      what: `this repository was rendered with kit ${input.repoKitVersion}; the kit here is ${input.kitVersion}`,
      why: "the method has moved on and this repository has not",
      fix: "run `mktrue sync` to see what would change, then `mktrue sync --write` to apply it",
      exit: EXIT.FINDINGS,
    });
  }

  return { findings, edited };
}
