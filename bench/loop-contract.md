# The bench

Six engineering subagents. The **lead** — your main session — orchestrates; each agent does bounded work and returns its report as its final message, which the lead saves to a file. This file is the loop's contract.

| Agent | Use it when | Writes code? |
| --- | --- | --- |
| `architect` | Starting a milestone, or a change spans more than one boundary. Produces the milestone plan and the kickoff page, `docs/design/<milestone>-kickoff.md`. | No — designs only |
| `implementer` | Building one bounded slice from the brief in the slice folder. | Yes |
| `ui-engineer` | A slice whose surface is the interface: screens, charts, responsive and offline behaviour. | Yes |
| `security-auditor` | **Only when triggered** (rule 5). | No — read-only |
| `reviewer` | After the build, and after the audit if there was one. Verifies by planting; verdict `approve` or `revise`. | No — read-only |
| `docs-writer` | Milestone boundaries, or when the docs have drifted from what is true. | Docs only |

**The loop:** `/start-slice` writes the brief → `implementer` or `ui-engineer` builds → `security-auditor` **if triggered** → `reviewer` plants → the lead runs `/close-slice`.

## The loop contract

Measured on the proving project's milestone 14: about 780 000 subagent tokens per slice, and the three most expensive single runs were a restart and two resumptions, not real work. Each rule below removes a measured cost without weakening a guard.

1. **One brief per slice, as a file.** `/start-slice` writes `brief.md` in the slice folder, `<main checkout>/.mktrue/slices/<slice-id>/`. The main checkout is the directory that holds the repository's `.git` directory, so every worktree shares the folder; `.mktrue/` is git-ignored, so it is never committed and never scanned by the prose budgets. The folder is always written out as an absolute path, never as a shell variable. Every agent is told `Read <slice folder>/brief.md and follow it exactly.` plus its role. The first line of every agent prompt names the slice, the role and the slice folder's absolute path, because `mktrue audit` attributes each agent from it (decision 0023). Nobody pastes a summary of another agent's work into a prompt — agents read the reports the lead saved.

2. **Reports come back as text; the lead saves them.** An agent writes no report file: the harness refuses one written by a subagent. It returns its report as its final message, **at most 600 words**: the verdict, must-fix findings with `file:line` (follow-ups as a count), the calls it judged that need a ruling, the plant table or the lines to plant, and the gate results. The lead saves that message **verbatim** to `<slice folder>/<role>.md` before spawning the next agent, and later agents read the saved file.

3. **Never resume a finished agent.** Resuming replays its whole transcript: on the proving project a follow-up to change two words cost 436 000 tokens, more than building an entire slice. A follow-up is a **fresh** agent with a short addendum to the brief and the saved report paths. A slice needing more than about 150 tool calls is two agents, split so that a restart stays cheap.

4. **Two full gate runs per slice, not four.** The implementer runs the full chain once, at the end. The lead runs it again at `/close-slice`, and **only the lead's numbers are quoted** anywhere. The reviewer runs only the suites its plants target; the auditor runs probes, not suites.

5. **Audit only when triggered.** The `security-auditor` runs when the diff touches any of: __MKTRUE_AUDIT_TRIGGERS__. Otherwise the record says "audit not triggered" and why. Auditor and reviewer never run at once.

6. **One canonical record.** At close the lead writes `<slice folder>/record.md`: what landed, rulings, the audit verdict, the plant table, the close-run numbers, and what is owed to the founder. Every other artefact — the pull request body, the board entry, the log — is derived from it, never written separately.

## What the contract must never cut

- **Mutation plants, every slice.** On the proving project every real defect in milestone 14 came from a plant; none came from reading. A plant and the run that proves it touch scratch space only (`/plant` has the rules): never the real home directory, never the shared temporary directory itself, never shared test support; a plant that needs a destructive call replaces the target with the scratch directory first.
- **Per-slice verification.** Never batch audits or reviews across slices. Every commit on the integration branch stays independently green, which is what lets slices merge unattended.
- **Decisions batched at kickoff.** `/start-milestone` publishes one kickoff page, under `docs/design/`, with every open call, its options and its cost. Slices do not accumulate questions.
- **The device pass.** The defect that mattered most in milestone 14 was found on a phone, by a person.

## Standing rules

1. **Never commit on a subagent's green.** Run `git status`, re-run what you are about to trust, and stage deliberately — never `git add -A`.
2. **Changes to the authentication surface are never routine.** They need an explicit instruction and a security-auditor pass.
3. **Known re-run traps.** Cap the build heap when a step is killed under memory pressure, and re-run only that step. After a SIGTERM, re-run only the steps that had not passed. Stop processes by PID, never `pkill -f`. Poll CI checks briefly instead of keeping a long-lived watcher. Write control characters as escape sequences in source, never as raw bytes — git treats such a file as binary — and keep escape sequences out of shell command text. Pass long text to a CLI with `--body-file`, not inline.

## The gates

__MKTRUE_GATES__
