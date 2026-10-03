# Start a slice

One evening's work, from a brief to a reviewed change. Do the steps in order.

## 1 · Place the slice

Read `docs/STATE.md` and the plan section for this slice. If the slice still has an open question for the founder, **stop**: it belongs on the milestone's kickoff page, not in this slice.

Branch in the main checkout if you are working alone, otherwise run `/worktree`.

## 2 · Make the slice folder

The slice folder is `<main checkout>/.mktrue/slices/<slice-id>`. The main checkout is the directory that holds the repository's `.git` directory, so every worktree shares the folder. Find it:

```
git rev-parse --path-format=absolute --git-common-dir
```

That prints `<main checkout>/.git`. Drop the trailing `.git`, write the slice folder out as an absolute path, and make it with that path typed in full:

```
mkdir -p <main checkout>/.mktrue/slices/<slice-id>
```

If the printed path does not end in `/.git` (a submodule or a bare layout), keep the slice folder at `<working tree root>/.mktrue/slices/<slice-id>/` instead; `mktrue audit` then attributes by the old rule only.

Every later step and every agent prompt uses that absolute path, never a shell variable. The folder is never committed and never scanned by the prose budgets: `.gitignore` must hold the line `.mktrue/`. Add it if the repository lacks it.

## 3 · Write `<slice folder>/brief.md`

Fixed sections: **Rulings · Shape · Must hold · Tests and plants · Audit · Reports**.

Name line ranges, not whole documents. Name the plants up front. Leave out history the agent can read in the report it is told to open. State the working directory as an absolute path, and say plainly: no commit, push, branch switch or stash unless told.

## 4 · Decide the audit now

The security auditor runs when the slice touches any of: __MKTRUE_AUDIT_TRIGGERS__. Write the decision into the brief either way — if it does not run, the brief says so and why.

## 5 · Run the agents one at a time, each spawned fresh

`implementer` or `ui-engineer` → `security-auditor` **if triggered** → `reviewer`.

Each agent returns its report as its final message and writes no report file. **Save that message verbatim** to `<slice folder>/<role>.md` before you spawn the next agent. Each agent reads the earlier saved reports, **never a summary you paste**. The auditor and the reviewer never run at once.

**Never send a follow-up to a finished agent; it replays its whole transcript.**

## 6 · Follow-ups are new agents

Append a `## Follow-up <n>` section to the brief with the saved report paths, and spawn a fresh agent against it.

## 7 · On an `approve` verdict

Run `/close-slice`.

## Done when

The brief has a saved report beside it for every agent that ran, the reviewer found no surviving plants, and the change is ready to close.
