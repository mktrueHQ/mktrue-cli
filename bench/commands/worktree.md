# Work in a worktree

One slice, one worktree. The integration branch is never the desk.

## Steps

1. Branch from __MKTRUE_BASE_BRANCH__. A deployed branch is never a base.
2. Create the worktree under `.claude/worktrees/<slice-id>`, so nothing outside the checkout changes and the agent harness can find it.
3. Install dependencies there only if the slice touches them.
4. Work only inside it, by absolute path, for the whole slice.
5. After `/close-slice` merges, remove the worktree and delete the branch.

## Rules

- Never commit directly to the deployed branch.
- Two slices never share a worktree. A second slice gets its own.
- **The worktree has no environment file and no secrets — leave it that way.** Both are git-ignored for a reason. A gate that needs them should be satisfiable with the example file and placeholder values.
- Never run a destructive or production-facing script from a worktree, or from anywhere. That is a person's job.
- An abandoned worktree is drift you can see. Remove it.

## Done when

The slice's work is isolated, and the branch it came from is untouched.
