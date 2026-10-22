import type { Budgets, ReadBudget } from "@mktrue/contracts";

import { EXIT, type Finding } from "./findings.js";

export type DocumentKind = Exclude<keyof Budgets, "context" | "reads" | "fixedReading">;

export interface Document {
  readonly path: string;
  readonly content: string;
  readonly kind: DocumentKind;
}

export function characterCount(content: string): number {
  return [...content].length;
}

const WHY: Record<DocumentKind, string> = {
  rules: "the rules file is read on every agent turn; state goes in docs/STATE.md",
  state: "the state file is replaced at every close; if it grows it has become a changelog",
  decision: "a decision is read whole when it is cited; past this size nobody reads it",
};

const FIX: Record<DocumentKind, string> = {
  rules: "move what is dated or in flight to docs/STATE.md, or raise budgets.rules",
  state: "move what already happened into docs/log/, or raise the budget in .mktrue.json",
  decision: "split it into the decisions it actually contains, one per file",
};

const number = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export function checkBudgets(
  documents: readonly Document[],
  budgets: Budgets,
): { findings: Finding[]; counts: ReadonlyMap<string, number> } {
  const findings: Finding[] = [];
  const counts = new Map<string, number>();

  for (const document of documents) {
    const size = characterCount(document.content);
    counts.set(document.path, size);
    const budget = budgets[document.kind];
    if (size > budget) {
      findings.push({
        gate: "budget",
        what: `${document.path} is ${number(size)} characters; the budget is ${number(budget)}`,
        why: WHY[document.kind],
        fix: FIX[document.kind],
        exit: EXIT.FINDINGS,
      });
    }
  }

  return { findings, counts };
}

export const DEFAULT_READ_BUDGET = 15_000;

const GLOB = /[*?]/;

function segmentsOf(path: string): string[] {
  return path.split(/[\\/]/).filter((segment) => segment !== "" && segment !== ".");
}

/** A listed path with `/` between segments, whichever separator it was written with. */
export function normaliseListed(path: string): string {
  return segmentsOf(path).join("/");
}

export function isGlob(path: string): boolean {
  return GLOB.test(path);
}

/** The directory a glob's matches all sit under: its segments before the first wildcard. */
export function globBase(pattern: string): string {
  const segments = segmentsOf(pattern);
  const first = segments.findIndex((segment) => isGlob(segment));
  return (first === -1 ? segments.slice(0, -1) : segments.slice(0, first)).join("/");
}

/** Every live position of `pattern` is stepped together, so no input backtracks. */
function segmentMatches(pattern: readonly string[], text: readonly string[]): boolean {
  const close = (live: boolean[]): boolean[] => {
    for (let i = 0; i < pattern.length; i++) if (live[i] && pattern[i] === "*") live[i + 1] = true;
    return live;
  };
  let live = close(pattern.map((_, i) => i === 0).concat(pattern.length === 0));
  for (const glyph of text) {
    const next = new Array<boolean>(pattern.length + 1).fill(false);
    for (let i = 0; i < pattern.length; i++) {
      if (!live[i]) continue;
      if (pattern[i] === "*") next[i] = true;
      else if (pattern[i] === "?" || pattern[i] === glyph) next[i + 1] = true;
    }
    live = close(next);
  }
  return live[pattern.length] === true;
}

/** `*` and `?` stay inside one segment, `**` spans any number; `/` and `\` both separate. */
export function matchesGlob(pattern: string, path: string): boolean {
  const wanted = segmentsOf(pattern).map((segment) => [...segment]);
  const last = wanted.length - 1;
  const isAny = (i: number) => wanted[i]!.length === 2 && wanted[i]!.join("") === "**";
  const close = (live: boolean[]): boolean[] => {
    for (let i = 0; i < last; i++) if (live[i] && isAny(i)) live[i + 1] = true;
    return live;
  };
  let live = close(wanted.map((_, i) => i === 0).concat(wanted.length === 0));
  for (const segment of segmentsOf(path)) {
    const glyphs = [...segment];
    const next = new Array<boolean>(wanted.length + 1).fill(false);
    for (let i = 0; i < wanted.length; i++) {
      if (!live[i]) continue;
      if (isAny(i)) next[i] = next[i + 1] = true;
      else if (segmentMatches(wanted[i]!, glyphs)) next[i + 1] = true;
    }
    live = close(next);
  }
  return live[wanted.length] === true;
}

export function clipLeft(text: string, room: number): string {
  const glyphs = [...text];
  if (glyphs.length <= room) return text;
  return `…${glyphs.slice(glyphs.length - Math.max(0, room - 1)).join("")}`;
}

export type ReadRefusal = "outside" | "directory" | "special" | "large";

const REFUSED: Record<ReadRefusal, { tail: string; why: string; fix: string }> = {
  outside: {
    tail: " resolves outside the repository",
    why: "check reads only files inside the repository, so it was not read",
    fix: "list the file where it lives inside the repository, or remove it",
  },
  directory: {
    tail: " is a directory",
    why: "a budget is per file, and a directory is not one",
    fix: "list a glob such as docs/*.md instead",
  },
  special: {
    tail: " is not a regular file",
    why: "a FIFO or a device can block a read or never end, so it was not read",
    fix: "list the regular file an agent reads, or remove the entry",
  },
  large: {
    tail: " is too large to read",
    why: "check reads a listed file whole, and this one is past its size cap",
    fix: "list the documents an agent reads, not this file",
  },
};

/** `refused` holds what the reader could not read: a file path, or a listed entry it could not walk. */
export function checkReadBudgets(
  reads: readonly ReadBudget[],
  files: ReadonlyMap<string, string>,
  width = Infinity,
  refused: ReadonlyMap<string, ReadRefusal> = new Map(),
): { findings: Finding[]; listed: number; files: number; over: number } {
  const findings: Finding[] = [];
  const judged = new Set<string>();
  const reported = new Set<string>();
  let over = 0;

  const refuse = (path: string, why: ReadRefusal): void => {
    if (reported.has(path)) return;
    reported.add(path);
    const text = REFUSED[why];
    findings.push({
      gate: "reads",
      what: `${clipLeft(path === "" ? "." : path, width - text.tail.length)}${text.tail}`,
      why: text.why,
      fix: text.fix,
      exit: EXIT.FINDINGS,
    });
  };

  for (const entry of reads) {
    const listed = normaliseListed(entry.path);
    const matches = (path: string): boolean =>
      isGlob(listed) ? matchesGlob(listed, path) : normaliseListed(path) === listed;
    const unread = [...refused].filter(([path]) => matches(path));
    for (const [path, why] of unread) refuse(path, why);
    const matched = [...files.keys()].filter(matches);
    if (matched.length === 0 && unread.length === 0) {
      const head = "budgets.reads lists ";
      const tail = ", which matches no file";
      findings.push({
        gate: "reads",
        what: `${head}${clipLeft(listed, width - head.length - tail.length)}${tail}`,
        why: "a listed path that matches nothing checks nothing, most likely a typo",
        fix: "correct the path in budgets.reads in .mktrue.json, or remove the entry",
        exit: EXIT.FINDINGS,
      });
      continue;
    }
    const budget = entry.characters ?? DEFAULT_READ_BUDGET;
    for (const path of matched) {
      if (judged.has(path)) continue;
      judged.add(path);
      const size = characterCount(files.get(path)!);
      if (size <= budget) continue;
      over += 1;
      const tail = ` · ${number(size)} / ${number(budget)} characters`;
      findings.push({
        gate: "reads",
        what: `${clipLeft(path, width - tail.length)}${tail}`,
        why: "an agent that reads it whole pays for all of it on every later call",
        fix: "split it, or read it by section",
        exit: EXIT.FINDINGS,
      });
    }
  }

  return { findings, listed: reads.length, files: judged.size, over };
}
