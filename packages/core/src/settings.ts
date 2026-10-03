import { EXIT, type Finding } from "./findings.js";

const finding = (what: string, why: string, fix: string): Finding => ({
  gate: "settings",
  what,
  why,
  fix,
  exit: EXIT.FINDINGS,
});

/** The deny rules a settings file carries, or undefined when it is not one. */
export function denyRules(source: string): string[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const permissions = (parsed as { permissions?: unknown }).permissions;
  if (permissions === undefined) return [];
  if (permissions === null || typeof permissions !== "object") return undefined;
  const deny = (permissions as { deny?: unknown }).deny;
  if (deny === undefined) return [];
  if (!Array.isArray(deny)) return undefined;
  return deny.filter((rule): rule is string => typeof rule === "string");
}

export interface SettingsCheck {
  readonly findings: Finding[];
  readonly rules: number;
  readonly present: number;
}

export function checkSettings(input: {
  readonly path: string;
  readonly kit: string | undefined;
  readonly current: string | undefined;
  readonly linkedOutside?: boolean;
}): SettingsCheck {
  const { path, current } = input;
  const kit = input.kit === undefined ? undefined : denyRules(input.kit);
  if (kit === undefined) return { findings: [], rules: 0, present: 0 };
  if (input.linkedOutside === true) {
    return { findings: [settingsLinkedOutside(path)], rules: kit.length, present: 0 };
  }

  if (current === undefined) {
    return {
      findings: [
        finding(
          `${path} is missing`,
          "the rules file promises that configuration stops an agent, and nothing does",
          "run mktrue sync --write: it writes the file when there is none",
        ),
      ],
      rules: kit.length,
      present: 0,
    };
  }

  const found = denyRules(current);
  if (found === undefined) {
    return {
      findings: [
        finding(
          `${path} does not parse as a settings file`,
          "an agent reads no rule from a file it cannot parse, so nothing is denied",
          `fix the JSON in ${path}; permissions.deny is a list of rules`,
        ),
      ],
      rules: kit.length,
      present: 0,
    };
  }

  const have = new Set(found);
  const missing = kit.filter((rule) => !have.has(rule));
  const findings: Finding[] = [];
  const first = missing[0];
  if (first !== undefined) {
    const others = missing.length - 1;
    findings.push(
      finding(
        `${path} lacks the deny rule ${first}${others > 0 ? ` and ${others} more` : ""}`,
        "a missing rule is something the rules file says cannot happen and can",
        `add ${first} to permissions.deny in ${path}`,
      ),
    );
  }

  const carveOuts = new Set(kit.filter(isNegation));
  const reopening = found.filter((rule) => isNegation(rule) && !carveOuts.has(rule));
  const reopens = reopening[0];
  if (reopens !== undefined) {
    const others = reopening.length - 1;
    findings.push(
      finding(
        `${path} reopens a deny rule with ${reopens.trim()}${others > 0 ? ` and ${others} more` : ""}`,
        "a ! rule cancels the deny rules listed before it, so what they stop is allowed again",
        `remove ${reopens.trim()} from permissions.deny in ${path}`,
      ),
    );
  }

  for (const carveOut of carveOuts) {
    if (!have.has(carveOut)) continue;
    const at = found.lastIndexOf(carveOut);
    const before = carvedFrom(carveOut, kit).find((rule) => found.lastIndexOf(rule) > at);
    if (before === undefined) continue;
    findings.push(
      finding(
        `${path} lists ${carveOut} before ${before}`,
        "a ! rule only carves out of the rules listed before it, so here it carves out of nothing",
        `move ${carveOut} after ${before} in permissions.deny in ${path}`,
      ),
    );
  }

  return { findings, rules: kit.length, present: kit.length - missing.length };
}

const RULE = /^\s*(\w+)\(\s*(!?)(.*)\)\s*$/s;

const isNegation = (rule: string): boolean => RULE.exec(rule)?.[2] === "!";

/** The kit's rules of the same tool whose pattern covers the path a carve-out names. */
function carvedFrom(carveOut: string, kit: readonly string[]): string[] {
  const carved = RULE.exec(carveOut);
  if (carved === null) return [];
  const [, tool, , target] = carved;
  return kit.filter((rule) => {
    const parts = RULE.exec(rule);
    if (parts === null || parts[1] !== tool || parts[2] === "!") return false;
    const pattern = (parts[3] ?? "").replace(/[.+^${}()|[\]\\?]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${pattern}$`).test(target ?? "");
  });
}

/** What check and sync say when the settings path leaves the repository through a link. */
export function settingsLinkedOutside(path: string): Finding {
  return finding(
    `${path} resolves outside this repository through a link`,
    "the deny rules an agent reads would live where this repository cannot keep them",
    `replace the link with a real file or directory, then run mktrue sync --write`,
  );
}

export const GATES_FIX = 'list them in .mktrue.json: "gates": ["pnpm test", …]';

export function checkGates(gates: readonly string[] | undefined): {
  findings: Finding[];
  gates: number;
} {
  const count = (gates ?? []).filter((gate) => gate.trim() !== "").length;
  if (count > 0) return { findings: [], gates: count };
  return {
    findings: [
      {
        gate: "gates",
        what: "the configuration lists no gates",
        why: "close-slice and the agents would render with nothing after the colon",
        fix: GATES_FIX,
        exit: EXIT.FINDINGS,
      },
    ],
    gates: 0,
  };
}
