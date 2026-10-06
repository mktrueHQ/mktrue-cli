# mktrue

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
