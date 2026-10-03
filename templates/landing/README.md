# __MKTRUE_NAME__

__MKTRUE_PURPOSE__

The public page of __MKTRUE_TITLE__, owned by __MKTRUE_OWNER__.

## Running it

```
pnpm install
cp .env.example .env
pnpm dev
```

`pnpm dev` runs the page on port 4200 and the API on 4201, and `pnpm format` formats the
workspace; `CLAUDE.md` §2 names the command that runs each part alone. The page reaches the
API only through `API_BASE_URL`: left blank, the request flow is off, its routes answer 503
and `/request-access` is a 404.

## Gates

```
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
```

CI runs the same five, in this order. A slice does not close with one red.

## Where an agent starts

Read `CLAUDE.md` first: it says what to read next, what the stack is and where things live.
Then run `/create-roadmap` to turn the purpose above into the first slices.
