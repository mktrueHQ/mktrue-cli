import type { Budgets } from "@mktrue/contracts";

import { EXIT, type Finding } from "./findings.js";

export interface Document {
  readonly path: string;
  readonly content: string;
  readonly kind: keyof Budgets;
}

export function characterCount(content: string): number {
  return [...content].length;
}

const WHY: Record<keyof Budgets, string> = {
  rules: "the rules file is read on every agent turn; state goes in docs/STATE.md",
  state: "the state file is replaced at every close; if it grows it has become a changelog",
  decision: "a decision is read whole when it is cited; past this size nobody reads it",
};

const FIX: Record<keyof Budgets, string> = {
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
