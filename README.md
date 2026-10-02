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
