# mktrue

mktrue is a command-line tool that turns a product idea into a repository an AI coding agent can build without drifting. `mktrue new` renders a template together with the rules, roles and commands the agent works under, runs the template's gates, and makes the first commit. `mktrue check` and `mktrue sync` then keep that repository in step as the method changes.

It sends nothing: no telemetry, no background process, no model keys.

## Requirements

- Node 24 or newer
- pnpm 11 or newer
- git, with `user.name` and `user.email` set
- Docker, only for the `infrastructure` template
- [Claude Code](https://claude.com/claude-code), for the skill and for building what `new` makes. The CLI itself runs without it.

`mktrue doctor` checks each of these. It prints the fix for a missing Node, pnpm, git or git identity, and reports Docker and Claude Code as found or not found.

## Install

```
npm i -g mktrue
```

Or a single binary for Linux or macOS, x64 or arm64, into `~/.local/bin`:

```
curl -fsSL https://github.com/mktrueHQ/mktrue-cli/releases/latest/download/install.sh | sh
```

The binary carries no skill. Install from npm if you want to start products from a Claude Code conversation.

## Check the machine

```
mktrue doctor --write
```

`doctor` reads the machine, not a repository: Node, git and its identity, pnpm, whether `mktrue` is on `PATH`, the skill link, Docker, Claude Code and the default model. Without `--write` it changes nothing. `--write` makes exactly one change: it links the skill into Claude Code's `skills` directory. The single binary carries no skill to link, so there `doctor --write` exits 3: the skill comes with the npm install.

## Make the first product

```
mktrue new application ledger
```

`new` asks its questions in the terminal: the purpose, the owner, who it is for, the stakes, the data the product holds and its languages, then what the template needs. Sign-in is asked for `application` and `api-service` only, with their ports; `landing` is asked a title and `infrastructure` the products it serves. Pass `--answers answers.json` to answer from a file instead.

It renders into a temporary directory beside the target, runs the template's gates there (install, typecheck, test and format check, and lint where the template has it; `infrastructure` runs its two script checks instead), runs `mktrue check`, commits on `main` under your git identity, and only then moves the tree to `./ledger`. If a gate fails, nothing is moved: the tree is kept, with a log, and the path is printed. `--offline` renders without installing, running the gates or committing, and says the result is not verified.

What it leaves in `./ledger`, in one commit:

- the product: the template's code and tests, a `README.md` about the product, its `pnpm-lock.yaml`, and a CI workflow that runs its gates
- the method: `CLAUDE.md`, `.claude/agents/`, `.claude/commands/`, `.claude/reference/`, `.claude/settings.json` with the deny rules, and a workflow that runs `mktrue check`
- the seed documents: `docs/STATE.md`, `docs/ROADMAP.md`, `docs/decisions/index.md`, `docs/design/README.md`, and the created log under `docs/log/`
- `.mktrue.json`: the answers, the template and kit versions, the budgets, the gates, and a hash of every file the kit owns

Then open Claude Code in `./ledger` and run:

```
/create-roadmap
```

## Templates

| Template | What it makes | Docker |
| --- | --- | --- |
| `application` | A whole product: the API service plus a Next.js web tier that reaches it only on the server. | no |
| `api-service` | An authenticated, multi-tenant HTTP API with no interface of its own. | no |
| `landing` | A public page with gated access: two locales, a signed request flow, and its own API. | no |
| `infrastructure` | An authenticated MongoDB replica set and the private network the products reach it on. | yes |

## Commands

| Command | What it does |
| --- | --- |
| `mktrue doctor [--write]` | Does this machine have what `new` and the skill need. |
| `mktrue new <template> <name>` | Make `./<name>` from a template, verified and committed. |
| `mktrue check` | Is this repository still true: budgets, bench integrity, role tiers, paths, the gates list, the settings file, drift. |
| `mktrue check --siblings` | Also compare the repositories this one names as siblings, through local git. |
| `mktrue sync [--write]` | Bring the method up to date, and write the settings file when there is none. A dry run unless `--write`. |
| `mktrue audit` | Measure this repository's local Claude Code transcripts into one HTML report. |
| `mktrue import` | Lift a template's files out of a product. For maintaining the kit, not a product. |

`mktrue <command> --help` prints that command's flags and exit codes. Exit codes are a contract: `0` true, `1` findings, `2` usage, `3` environment, `4` a decision is needed.

## The skill

The package carries a Claude Code skill in `skill/mktrue`, and `mktrue doctor --write` links it. In a Claude Code conversation, describe the product in one sentence: the skill proposes a template and a name, asks the same questions `new` asks, in one round, writes the answers to a file, and runs the same `mktrue new` you would type. It renders nothing itself.

## More

https://mktrue.dev

## Licence

MIT. Code that mktrue generates carries no licence and belongs to whoever ran the command.
