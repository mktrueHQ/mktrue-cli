# mktrue

## 1.2.0

### Minor Changes

- fc8a7ba: `mktrue audit` measures a week. `--since <date>` and `--until <date>` keep the records from one local midnight up to, not including, another, dropped before any figure. A test run is its own class, one per shell command, counted per package where the command names one (`pnpm test`, `pnpm -r test`, `pnpm --filter <p> test`, `pnpm -C <dir> test`, `pnpm exec vitest run`, `pnpm vitest run`, `npx vitest run`). The pull requests merged in the window are the first-parent commits on the base branch, read through local git, beside the processed tokens per merged pull request; nothing is sent. `--json` is schema 2: it adds `window`, `testRuns`, `merged`, `totals.processed`, `totals.processedTokens` and `subagentOnly`, which names the figures that leave the lead out, and keeps every field of schema 1.
- 293df55: `mktrue guard` is the Claude Code hook that holds the context budget (decision 0041). The bench settings body now runs it before every tool call (`PreToolUse`) and as `mktrue guard --resume` after a `/clear` (`SessionStart`, matcher `clear`). It reads the last usage record from the tail of the session's transcript, and a subagent's own transcript and call count, against `budgets.context` in `.mktrue.json`: the lead is warned at 150k context and refused past 200k, except its write of `<main checkout>/.mktrue/slices/<id>/resume.md`; a subagent is warned at 200k context or 150 calls and refused past 250k. Without `.mktrue.json`, or with nothing to measure, it prints nothing and the call goes ahead. It sends nothing and writes nothing. After a `/clear` it puts the newest `resume.md` in context. `mktrue check` reports a settings file that lacks either hook, or runs another command in its place; `sync` still never rewrites an existing settings file, so a product adds the two hook entries by hand. The loop contract's rule 3 and `/close-slice` step 6 stop on context, not calls only.
- d02f009: A slice has a shape (decision 0042). The loop contract states it once: every agent prompt opens with exactly `Slice <id>, role <role>, slice folder <absolute path>.`; a slice takes at most four runs, five when a `ui-engineer` runs in it; every run is spawned with its bench role as the agent type, and no other role name is used; a follow-up is a fresh run of the role that owns the work and counts. Rebase and commit are the lead's close, plants the reviewer's, decisions the architect's or the lead's. The `ui-engineer` runs its own browser pass, at 360px against the mockup of the same screen, before its report. `mktrue audit` reads the slice and the role from that first line, keeps the slice folder path as the fallback for older transcripts, and reports, as findings and not as an exit code, the runs with no role and their share, the invented roles by name, the runs whose model is not their role's, and the slices over their bound. `--json` is schema 3: it adds `agents[].statedRole`, `slices[].bound` and `shape`, and keeps every field of schema 2. `mktrue doctor`, in a repository with a `.mktrue.json`, names every bench role with no file in `.claude/agents/` whose frontmatter `name` is that role; it reads only inside the repository and writes nothing.

## 1.1.1

### Patch Changes

- b272e1f: Security fix in the `landing` template: the token a browser holds no longer carries a hash of the mailed code, which let anyone recover the code and verify an address they do not own. Five wrong codes now kill a token, errors answer with fixed bodies, the request log drops the query, IPv6 clients are limited by /64, and the API does not boot with a token secret under 32 characters wherever `RESEND_API_KEY` is set. `mktrue sync` does not carry template files: a landing made with 1.1.0 or earlier needs the same change by hand, described in decision 0040.

## 1.1.0

### Minor Changes

- bb327ec: The method says each rule once. `/plant` and `/worktree` stop being commands and become reference files, `.claude/reference/plant.md` and `.claude/reference/worktree.md`, read when an agent or the lead is pointed at them. `/review-security` is retired: its triage rules are part of `/start-slice`'s agent step. `/start-slice` splits in two: `/brief` writes the brief and stops, and `/start-slice` reads it and runs the agents. The report protocol lives in `.claude/agents/README.md` alone, and each agent description says when to use it. Run `mktrue sync` to see the change, then `mktrue sync --write`: it deletes each retired command you never edited and drops it from `owned`. One you edited is a conflict, kept in place: delete it, or pin it to keep it. Until the sync runs, `mktrue check` reports each retired file as drift.

## 1.0.0

### Major Changes

- 980e3b2: A product made by 1.0.0 starts true on its first day. `mktrue new` now writes `.claude/settings.json` with deny rules for secret files, force-pushes and hard resets, and `mktrue check` reports when one goes missing; `CLAUDE.md` arrives with its stack and its file map already written from the template, and never says "holds: ." when a product holds nothing sensitive; the created log records the template, the kit version, your answers and the gates. The web templates refuse instead of falling back: a blank `API_BASE_URL` no longer means localhost, and both send HSTS and no `X-Powered-By`. `pnpm format:check` and `pnpm lint` work as written and are gates, whatever the product is called; landing offers no link to a request page that is off, a fresh application's `.env.example` points the web at its API, the landing `.env.example` names only what the code reads, and every product gets a README about itself. In a repository you already have, run `mktrue sync --write`: it writes the settings file if you have none, and if you keep your own, `check` names the deny rule to add. A `.mktrue.json` with no `gates` is now a finding, and `sync` refuses until you list them.

### Minor Changes

- ae84085: The slice loop runs in today's Claude Code. The slice folder moves out of `.git` to `.mktrue/slices/<slice-id>/` in the main checkout, and no bench instruction needs a compound command. Agents return their reports as text, at most 600 words, and the lead saves them. The kickoff page lives in `docs/design/`, outside the decision budget. Plants stay in scratch space, never the real home or `/tmp`. `/close-slice` reads the pull request as `MERGED` before any cleanup. `mktrue audit` attributes subagents from the new folder and still reads the old one, and a kit-checkout build that is older than its bench says so instead of reporting a parse error. After `mktrue sync --write`, add `.mktrue/` to `.gitignore` if it is not there.

## 0.3.1

### Patch Changes

- 7b40506: Your repository's `.github/workflows/mktrue.yml` now installs the exact mktrue version that rendered it from npm, checks its registry signature with `npm audit signatures`, and runs `mktrue check`. It no longer downloads a release with a `MKTRUE_TOKEN` secret. Run `mktrue sync --write`, merge the change, and then delete the `MKTRUE_TOKEN` secret from your repository.

## 0.3.0

### Minor Changes

- edd6e56: The implementer and the ui-engineer run on `opus` at `high` effort, where they ran on `sonnet` at `medium`. Measured on one milestone per tier, the cheaper tier took 3.4 times the calls and twice the agent runs per slice (decision 0037). Run `mktrue sync --write` to take the two agent files.
- f6a80d6: mktrue is released from `mktrueHQ/mktrue-cli`. Each release ships single executables for Linux and macOS, x64 and arm64, with `SHA256SUMS` and `install.sh`. The installer checks the checksum, then the build attestation when `gh` is present, and moves the binary last. The npm package is staged with provenance, and it reaches `latest` only after a device pass.
