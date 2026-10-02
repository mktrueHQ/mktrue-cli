# __MKTRUE_NAME__

An authenticated, multi-tenant HTTP API, owned by __MKTRUE_OWNER__.

```
packages/contracts     every shape that crosses a boundary, as zod schemas
services/api           the API: contexts, controllers, middlewares, composition root
docs/                  why the code is shaped the way it is
```

- [docs/architecture.md](docs/architecture.md): the hexagon, owner-first ports, one
  clock per user, errors, and the placeholder context.
- [docs/security.md](docs/security.md): tenancy, default-deny, fail-closed
  authentication, the whitelist and the identity seam.

Every rule in those two files is enforced by a test, and each rule names its test.

**`contexts/example` is a placeholder.** Rename it to your first domain noun, or delete
it.

## Running it

```
pnpm install
pnpm typecheck
pnpm test
pnpm --filter @__MKTRUE_NAME__/api dev
```

A fresh clone runs with no `.env` at all. `/health` answers 200 with
`mongo: "disconnected"`, and every other route answers 503 until the keys in
`.env.example` are filled in.
