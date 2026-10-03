# mktrue

A command-line tool that turns a product idea into a repository an AI coding agent can build without drifting, and keeps every repository it made in step as the method improves.

This repository is the public source of each mktrue release: one commit per release, holding exactly what builds the npm package and the binaries. Development happens elsewhere, so this history has no other commits and takes no pull requests.

## Install

```
npm i -g mktrue
```

Or a single binary for Linux or macOS, x64 or arm64, into `~/.local/bin`:

```
curl -fsSL https://github.com/mktrueHQ/mktrue-cli/releases/latest/download/install.sh | sh
```

The installer checks the binary against the release's `SHA256SUMS` before it moves anything, and checks its attestation when `gh` is installed. `MKTRUE_VERSION=1.2.3` installs one version; `MKTRUE_CHANNEL=next` allows a prerelease.

The binary carries no skill; the npm package does.

## Requirements

- Node 24 or newer
- pnpm 11 or newer
- git, with `user.name` and `user.email` set
- Docker, only for the `infrastructure` template
- [Claude Code](https://claude.com/claude-code), for the skill and for building what `new` makes

## Use

```
mktrue doctor --write
```

`mktrue doctor` checks each of these. It prints the fix for a missing Node, pnpm, git or git identity, and reports Docker and Claude Code as found or not found. `--write` makes exactly one change: it links the Claude Code skill the npm package carries. The single binary carries no skill to link, so there `doctor --write` exits 3: the skill comes with the npm install.

```
mktrue new application ledger
```

`new` asks its questions in the terminal, or reads them from `--answers <file>`. It renders the template, runs the template's gates (install, typecheck, test and format check, and lint where the template has it), runs `mktrue check`, commits on `main`, and only then moves the tree to `./ledger`. Then open Claude Code in `./ledger` and run `/create-roadmap`.

| Template | What it makes | Docker |
| --- | --- | --- |
| `application` | A whole product: the API service plus a Next.js web tier that reaches it only on the server. | no |
| `api-service` | An authenticated, multi-tenant HTTP API with no interface of its own. | no |
| `landing` | A public page with gated access: two locales, a signed request flow, and its own API. | no |
| `infrastructure` | An authenticated MongoDB replica set and the private network the products reach it on. | yes |

`mktrue --help` lists the commands, and `mktrue <command> --help` prints one command's flags and exit codes. More at https://mktrue.dev.

## Verify

Every release is built by `.github/workflows/release.yml` from the commit its tag names.

```
npm audit signatures                                   # in a project that installed mktrue
gh attestation verify mktrue-linux-x64.tar.xz --repo mktrueHQ/mktrue-cli
```

## Build from source

Node 24 and pnpm 11:

```
pnpm install --frozen-lockfile
pnpm build
node scripts/pack-proof.mjs
node scripts/build-sea.mjs --archive release
```

## Licence

MIT. Code that mktrue generates carries no licence and belongs to whoever ran the command.
