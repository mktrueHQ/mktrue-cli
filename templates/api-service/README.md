# __MKTRUE_NAME__

__MKTRUE_PURPOSE__

Owned by __MKTRUE_OWNER__.

## Running it

```
pnpm install
cp .env.example .env
pnpm dev
```

`pnpm dev` runs every part of the workspace, and `pnpm format` formats it; `CLAUDE.md` §2 names each part and the
command that runs it alone. A fresh clone runs with a blank `.env`: `/health` answers 200
with `mongo: "disconnected"`, and every other route answers 503 until the keys in
`.env.example` are filled in.

`contexts/example` is a placeholder: rename it to the first domain noun, or delete it.

## Gates

```
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm format:check
```

CI runs the same four, in this order. A slice does not close with one red.

## The rules

- [docs/architecture.md](docs/architecture.md): the hexagon, owner-first ports, one
  clock per user, errors, and the placeholder context.
- [docs/security.md](docs/security.md): tenancy, default-deny, fail-closed
  authentication, the whitelist and the identity seam.

Every rule in those two files is enforced by a test, and each rule names its test.

## Where an agent starts

Read `CLAUDE.md` first: it says what to read next, what the stack is and where things live.
Then run `/create-roadmap` to turn the purpose above into the first slices.
