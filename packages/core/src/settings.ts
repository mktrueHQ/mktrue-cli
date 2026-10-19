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

export interface SettingsHook {
  readonly event: string;
  readonly matcher: string;
  readonly command: string;
}

/** The command hooks a settings file carries, or undefined when its hooks do not parse. */
export function hookCommands(source: string): SettingsHook[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const hooks = (parsed as { hooks?: unknown }).hooks;
  if (hooks === undefined) return [];
  if (hooks === null || typeof hooks !== "object" || Array.isArray(hooks)) return undefined;
  const found: SettingsHook[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups as unknown[]) {
      if (group === null || typeof group !== "object") continue;
      const { matcher, hooks: handlers } = group as { matcher?: unknown; hooks?: unknown };
      if (matcher !== undefined && typeof matcher !== "string") continue;
      if (!Array.isArray(handlers)) continue;
      for (const handler of handlers as unknown[]) {
        if (handler === null || typeof handler !== "object") continue;
        const { type, command } = handler as { type?: unknown; command?: unknown };
        if (type !== "command" || typeof command !== "string") continue;
        found.push({ event, matcher: matchesAll(matcher) ? "" : matcher, command: command.trim() });
      }
    }
  }
  return found;
}

const matchesAll = (matcher: string | undefined): matcher is undefined | "" | "*" =>
  matcher === undefined || matcher === "" || matcher === "*";

const sameHook = (a: SettingsHook, b: SettingsHook): boolean =>
  a.event === b.event && a.matcher === b.matcher && a.command === b.command;

const hookName = (hook: SettingsHook): string =>
  `${hook.event}${hook.matcher === "" ? "" : ` (${hook.matcher})`} hook`;

export interface SettingsCheck {
  readonly findings: Finding[];
  readonly rules: number;
  readonly present: number;
  readonly hooks: number;
  readonly hooksPresent: number;
}

export function checkSettings(input: {
  readonly path: string;
  readonly kit: string | undefined;
  readonly current: string | undefined;
  readonly linkedOutside?: boolean;
}): SettingsCheck {
  const { path, current } = input;
  const kit = input.kit === undefined ? undefined : denyRules(input.kit);
  if (kit === undefined) return { findings: [], rules: 0, present: 0, hooks: 0, hooksPresent: 0 };
  const kitHooks = (input.kit === undefined ? undefined : hookCommands(input.kit)) ?? [];
  const none = { rules: kit.length, present: 0, hooks: kitHooks.length, hooksPresent: 0 };
  if (input.linkedOutside === true) {
    return { findings: [settingsLinkedOutside(path)], ...none };
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
      ...none,
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
      ...none,
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

  const currentHooks = hookCommands(current) ?? [];
  const missingHooks = kitHooks.filter(
    (hook) => !currentHooks.some((have) => sameHook(hook, have)),
  );
  const firstHook = missingHooks[0];
  if (firstHook !== undefined) {
    const others = missingHooks.length - 1;
    const other = currentHooks.find(
      (have) => have.event === firstHook.event && have.matcher === firstHook.matcher,
    );
    findings.push(
      finding(
        other === undefined
          ? `${path} lacks the ${hookName(firstHook)}${others > 0 ? ` and ${others} more` : ""}`
          : `${path} runs another command as its ${hookName(firstHook)}`,
        "without the hook nothing stops a session past its context ceiling",
        `add the command "${firstHook.command}" to hooks.${firstHook.event}` +
          `${firstHook.matcher === "" ? "" : ` (${firstHook.matcher})`}`,
      ),
    );
  }

  return {
    findings,
    rules: kit.length,
    present: kit.length - missing.length,
    hooks: kitHooks.length,
    hooksPresent: kitHooks.length - missingHooks.length,
  };
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
