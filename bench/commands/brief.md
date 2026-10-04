# Write the brief

The leg work before a slice: place it, make its folder, write its brief, decide its audit. Do the steps in order.

## 1 · Place the slice

Read `docs/STATE.md` and the plan section for this slice. If the slice still has an open question for the founder, **stop**: it belongs on the milestone's kickoff page, not in this slice.

Branch in the main checkout if you are working alone, otherwise work in a worktree. If you need the worktree rules, read `.claude/reference/worktree.md`.

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

Stop here. Running the agents is `/start-slice`.
