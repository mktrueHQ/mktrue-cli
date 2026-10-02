## 9 · Budgets and drift

<!-- Owned by this repository. mktrue renders this heading and never touches what follows. -->

| Document          | Budget, in characters      |
| ----------------- | -------------------------- |
| this rules file   | __MKTRUE_BUDGET_RULES__    |
| `docs/STATE.md`   | __MKTRUE_BUDGET_STATE__    |
| one decision file | __MKTRUE_BUDGET_DECISION__ |

These are enforced by a gate, not by good intentions. Over budget is a finding.

`mktrue check` reports drift: files mktrue owns that were edited without a pin, a kit version behind, budgets exceeded, missing permission rules. It runs in CI on every push.
