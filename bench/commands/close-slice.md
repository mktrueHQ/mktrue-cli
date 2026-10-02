# Close a slice

Gates, merge, state replaced. **Do the steps in order; do not skip one because it obviously passed.**

## 1 · The tree is yours and clean of plants

`git status`. Confirm no agent is still running. Verify the reviewer's snapshot manifest with `sha256sum -c`. Run the formatter check — a formatter-clean plant would reach the integration branch behind a green build.

## 2 · The authoritative gate run

Run the chain **package by package, in the foreground**, never as one parallel run: __MKTRUE_GATES__

A red count **or a skipped count** is a stop, not a caveat: re-run that suite alone before believing either. If a step is killed under memory pressure, re-run only the steps that had not passed, with a larger heap. **These are the only numbers quoted anywhere** — not the agents'.

## 3 · The canonical record

Write `$SLICE/record.md`: what landed · the rulings made · the audit verdict, or "not triggered, because …" · the plant table · the close-run numbers · what is owed to the founder.

The pull request body, the board entry and the log entry are all derived from this file, never written separately.

## 4 · Pull request and merge

Open it against __MKTRUE_BASE_BRANCH__, passing long text with `--body-file` rather than inline. Check CI with a **short poll** whose exit code you inspect — never a long-lived background watcher, and never piped into a merge chain. No verdict, no merge.

## 5 · Replace `docs/STATE.md`

From the record, not from memory. **Replaced, never appended.** Under __MKTRUE_BUDGET_STATE__ characters. A settled decision's own file and its index line exist before this step.

## 6 · Leave the tree

Delete the branch, remove the worktree, keep `$SLICE` until the milestone closes. Then clear the session: the next slice starts from `docs/STATE.md`.

## Done when

Gates green, `mktrue check` exit 0, merged, state replaced, worktree gone.
