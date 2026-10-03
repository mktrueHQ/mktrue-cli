# __MKTRUE_NAME__

__MKTRUE_PURPOSE__

An authenticated MongoDB replica set and the private network its consumers reach it on.

## Running it

```
cp .env.example .env
docker compose up -d
```

That is the local stack. `CLAUDE.md` §2 names the production one, and what to run before
and after a deploy.

## Gates

```
sh scripts/shellcheck.sh
sh scripts/compose-check.sh
```

Both need Docker and nothing else. A slice does not close with one red.

## Where an agent starts

Read `CLAUDE.md` first: it says what to read next, what the stack is and where things live.
Then run `/create-roadmap` to turn the purpose above into the first slices.
