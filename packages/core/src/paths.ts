import { EXIT, type Finding } from "./findings.js";

export type PathMatches = ReadonlyMap<string, number>;

const LABEL: Record<string, string> = {
  state: "the state file",
  roadmap: "the roadmap",
  decisionsIndex: "the decision index",
  decisions: "the decision files",
  design: "the design documents",
  log: "the log",
};

export function checkDocumentPaths(
  paths: Readonly<Record<string, string>>,
  matches: PathMatches,
): { findings: Finding[]; resolved: number; total: number } {
  const findings: Finding[] = [];
  let resolved = 0;
  let total = 0;

  for (const [key, pattern] of Object.entries(paths)) {
    if (pattern === "") continue;
    total += 1;
    const found = matches.get(pattern) ?? 0;
    if (found > 0) {
      resolved += 1;
      continue;
    }
    findings.push({
      gate: "paths",
      what: `${LABEL[key] ?? key} is declared as ${pattern}, which matches nothing`,
      why: "the rules block names this path to every agent that opens the repository, so a row that resolves to nothing sends each of them looking for a file that is not there",
      fix: `set paths.${key} in .mktrue.json to where this repository actually keeps it, then run \`mktrue sync --write\``,
      exit: EXIT.FINDINGS,
    });
  }

  return { findings, resolved, total };
}
