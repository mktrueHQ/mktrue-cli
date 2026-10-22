# The bench

Six engineering subagents: `architect`, `implementer`, `ui-engineer`, `security-auditor`, `reviewer` and `docs-writer`; each one's description says when to use it. The **lead**, your main session, orchestrates; each agent does bounded work. This file is the loop's contract, and every agent reads it.

**The loop:** `/brief` writes the brief → `/start-slice` runs `implementer` or `ui-engineer` → `security-auditor` **if triggered** → `reviewer` plants → the lead runs `/close-slice`.

## The loop contract

1. **One brief per slice, as a file.** `/brief` writes `brief.md` in the slice folder, `<main checkout>/.mktrue/slices/<slice-id>/`. The main checkout holds the repository's `.git` directory, so every worktree shares the folder; `.mktrue/` is git-ignored, never committed and never scanned by the prose budgets. The folder is always written out as an absolute path, never as a shell variable. Every agent is told `Read <slice folder>/brief.md and follow it exactly.` plus its role. The first line of every agent prompt is exactly `Slice <id>, role <role>, slice folder <absolute path>.`, with nothing before it and nothing more on it: `mktrue audit` reads the slice and the role from that line, and a run whose first line differs is a run with no role. Every agent reads `CLAUDE.md`, `docs/STATE.md`, its brief and the sections the brief cites, nothing wider. Nobody pastes a summary of another agent's work into a prompt — agents read the reports the lead saved.

2. **Reports come back as text; the lead saves them.** An agent writes no report file. It returns its report as its final message, **at most 600 words**, leading with the verdict: then must-fix findings with `file:line` (follow-ups as a count), the calls it judged that need a ruling, the plant table or the lines to plant, and the gate results. The lead saves that message **verbatim** to `<slice folder>/<role>.md` before spawning the next agent, and later agents read the saved file.

3. **Never resume a finished agent, and stop on context, not calls only.** Resuming replays its whole transcript. A follow-up is a **fresh** run of the role that owns the work, with a short addendum to the brief and the saved report paths. A slice needing more than about 150 tool calls or 200k context is two agents. `mktrue guard`, the hook in `.claude/settings.json`, holds the budgets `.mktrue.json` sets: a subagent warned at 200k context or 150 calls returns its report; the lead warned at 150k context writes `<slice folder>/resume.md` (what is done, what is next, the files to read) and stops for the founder's `/clear`, and the hook puts `resume.md` back in context. Past the ceiling, 200k for the lead and 250k for a subagent, every call is refused but the lead's write of `resume.md`.

4. **Two full gate runs per slice, not four.** The implementer runs the full chain once, at the end, package by package and in the foreground. The lead runs it again at `/close-slice`, and **only the lead's numbers are quoted** anywhere. The reviewer runs only the suites its plants target; the auditor runs probes, not suites.

5. **Audit only when triggered.** The `security-auditor` runs when the diff touches any of: __MKTRUE_AUDIT_TRIGGERS__. Otherwise the record says "audit not triggered" and why. Auditor and reviewer never run at once.

6. **One canonical record.** At close the lead writes `<slice folder>/record.md`: what landed, rulings, the audit verdict, the plant table, the close-run numbers, and what is owed to the founder. Every other artefact — the pull request body, the board entry, the log — is derived from it, never written separately.

7. **A slice is at most four runs, five for a UI slice.** A run is one agent spawned for the slice: a resumed agent is still one run, and a follow-up (rule 3) counts. A UI slice is one a `ui-engineer` runs in. Spawn every run with its role as the agent type, and use no role name the bench does not have. Work that seems to need another role is placed, not renamed: rebase and commit are the lead's close, plants are the `reviewer`'s, decisions are the `architect`'s or the lead's. `mktrue audit` flags a run with no role, a role the bench does not have, a run whose model is not its role's, and a slice over its bound.

## What the contract must never cut

- **Mutation plants, every slice.** A plant and the run that proves it touch scratch space only. If you need the plant rules, read `.claude/reference/plant.md`.
- **Per-slice verification.** Never batch audits or reviews across slices. Every commit on the integration branch stays independently green.
- **Decisions batched at kickoff.** `/start-milestone` publishes one kickoff page, `docs/design/<milestone>-kickoff.md`, with every open call, its options and its cost. Slices do not accumulate questions.
- **The device pass**, by a person, on a phone.

## Standing rules

1. **Never commit on a subagent's green.** Run `git status`, re-run what you are about to trust, and stage deliberately — never `git add -A`.
2. **Changes to the authentication surface are never routine.** They need an explicit instruction and a security-auditor pass.
3. **Known re-run traps.** After a SIGTERM, or a step killed under memory pressure, re-run only the steps that had not passed, with a larger heap. Pass long text to a CLI with `--body-file`, not inline. Stop processes by PID, never `pkill -f`.
4. **Reads stay small.** A document over its read budget, `budgets.reads` in `.mktrue.json`, is read by section, never whole: search it, then read the lines you need. A mockup is split per screen at handoff, one file per screen, and each screen is listed with its budget.
5. **A session loads what its template allows.** The template names the plugins and MCP servers a session needs, and `mktrue doctor` lists what one loads (the rules file, the role files, the plugins enabled, the MCP servers configured) and names anything else, with where to turn it off. The user-level configuration is the founder's: the kit names the change and makes none.

## The gates

__MKTRUE_GATES__
