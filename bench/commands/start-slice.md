# Start a slice

One evening's work, from a brief to a reviewed change. Do the steps in order.

## 1 · Place the slice

Read `docs/STATE.md` and the plan section for this slice. If the slice still has an open question for the founder, **stop**: it belongs on the milestone's decision page, not in this slice.

Branch in the main checkout if you are working alone, otherwise run `/worktree`.

## 2 · Make the slice folder

```
SLICE="$(git rev-parse --path-format=absolute --git-common-dir)/slices/<slice-id>" && mkdir -p "$SLICE"
```

It lives inside `.git`: shared by every worktree, never committed, never scanned by the prose budgets.

## 3 · Write `$SLICE/brief.md`

Fixed sections: **Rulings · Shape · Must hold · Tests and plants · Audit · Reports**.

Name line ranges, not whole documents. Name the plants up front. Leave out history the agent can read in the report it is told to open. State the working directory as an absolute path, and say plainly: no commit, push, branch switch or stash unless told.

## 4 · Decide the audit now

The security auditor runs when the slice touches any of: __MKTRUE_AUDIT_TRIGGERS__. Write the decision into the brief either way — if it does not run, the brief says so and why.

## 5 · Run the agents one at a time, each spawned fresh

`implementer` or `ui-engineer` → `security-auditor` **if triggered** → `reviewer`.

Each reads the earlier reports in `$SLICE`, **never a summary you paste**. The auditor and the reviewer never run at once.

**Never send a follow-up to a finished agent; it replays its whole transcript.**

## 6 · Follow-ups are new agents

Append a `## Follow-up <n>` section to the brief with the earlier report paths, and spawn a fresh agent against it.

## 7 · On an `approve` verdict

Run `/close-slice`.

## Done when

The brief has a report beside it for every agent that ran, the reviewer found no surviving plants, and the change is ready to close.
