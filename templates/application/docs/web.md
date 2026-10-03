# The web tier

How `apps/web` is shaped, and the rules that shape it. The API's own rules are in
[architecture.md](architecture.md) and [security.md](security.md). Every rule here names
the test that fails when it is broken; the test keeps the rule, this page explains it.

```
apps/web
  app/            pages, the error and not-found boundaries, Server Actions
  dev-session/    the local stand-in for the auth provider, and the launcher that binds it
  i18n/           the request's locale and its catalogue
  lib/            the one way to the API, config, the session token, refusal copy
  messages/       one catalogue per locale the contract declares
  proxy.ts        default-deny for pages
  test/           mirrors the tree above
```

Running it locally, with the API: `pnpm --filter @__MKTRUE_NAME__/api dev` and
`pnpm --filter @__MKTRUE_NAME__/web dev`. The web reads the repo-root `.env`, the same file
the API reads. Beyond the API's variables it reads three: `API_BASE_URL` (no default: blank,
every call to the API is refused as unavailable and nothing is fetched; `.env.example` sets
it to `http://localhost:__MKTRUE_API_PORT__`, the API's development port), and the Clerk pair
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`.

## The contract drives the web, and the compiler says so

The web tier switches **exhaustively**, with no default branch, over every closed list it
shares with the API: the item statuses in `lib/example-item-status.ts`, and the error
codes in `lib/api.ts`. Widen either list in `packages/contracts` and the web tier stops
typechecking until somebody decides what it says about the new value. A lookup with a
fallback would instead ship the wrong word, and nothing would notice.

Enforced by `test/lib/example-item-status.test.ts`. It typechecks the real web tier with
the TypeScript compiler: once as it stands, which must be clean; once with a status added
to `EXAMPLE_ITEM_STATUSES` in memory, which must fail in `lib/example-item-status.ts`; and
once with a code added to `apiErrorCodeSchema` in memory, which must fail in `lib/api.ts`.
Each widening must produce exactly one error, the switch's missing return. Give either
switch a `default` and the test goes red. When you rename the exemplar, keep the switch
and the test with it.

## The web reaches the API on the server, with the session's token, from one file

- `lib/api.ts` is the only file that calls `fetch`, and the browser never calls the API.
- It sends the caller's identity one way: `Authorization: Bearer <token>`, where the token
  is minted by the auth provider for this request in `lib/owner-token.ts`. The web tier
  never sends a user id, and never reads one from a cookie, a header or the URL. The API
  decides who the token belongs to.
- A call never throws. Every answer becomes an `ApiResult` a page can render: 403 is the
  account, 401 the session, 503 a wait, and anything the contract refuses is a wait too.
- A 403 sends the page to `/no-access`, because the API only ever answers 403 for an
  account it does not admit.

Enforced by `test/lib/api.test.ts` (the exact headers, no call without a token, every
error code), `test/lib/owner-token.test.ts` (the session's token, even with a dev-session
id set beside real provider keys) and `test/lib/where-the-caller-comes-from.test.ts`
(which files may ask the session, hand the token on, or call `fetch`).

## Every page is closed unless it is listed

`proxy.ts` protects every path its matcher covers, and the matcher covers every path but
Next's own files and paths ending in a static file's extension. A dot alone does not
skip it: `/items/a.b` is a page, and pages are closed. `PUBLIC_PAGES` is the whole open
surface, and it is `/sign-in` and the provider's steps under it. A page added tomorrow
is protected without anybody touching the proxy. **Adding an entry is a security
decision.**

The skip is decided from the path alone, so it has one limit: a dynamic page whose segment
ends in a static file's extension, such as `/items/x.png`, skips the proxy and renders.
Its calls to the API still fail closed, because without the proxy no session token is
minted, but the page itself is not closed. Do not let a dynamic segment accept a value
ending in a static file's extension.

With no sign-in configured, the proxy lets requests through and every page says so
instead of rendering: there is no token, so there is nothing to show.

Enforced by `test/proxy.test.ts`, which pins the list by equality and walks every page in
`app/`.

## The dev session

With `DEV_AUTH_USER_ID` set, `pnpm dev` replaces the auth provider with the stand-ins in
`dev-session/`, so every page renders signed in as that id without real keys. The
stand-in hands the id to the API as the token, and the API admits it only under its own
dev-session rules. **A dev session that could switch on in production would be an
authentication bypass**, so four things hold it to one machine in development:

1. **The phase is the lock.** `next.config.ts` wires the stand-ins in only in Next's
   development-server phase. `next build` and `next start` are other phases whatever the
   environment says, and `NODE_ENV=development next build` still builds without them. So
   no variable anybody sets reaches the stand-ins outside `next dev`.
2. **The stand-ins refuse to load** under any `NODE_ENV` but `development`, which
   `next start` never runs under.
3. **The bind.** `dev` runs `dev-session/serve.ts`, which starts `next dev` on
   `localhost` and marks the process so. It accepts no arguments, so an `-H` passed
   through cannot widen it. A dev server without the mark refuses the dev session at
   config time, which also covers `next dev` started by hand and every restart Next makes
   of its own server.
4. **The Host.** Under the dev session, a request not addressed to a loopback name is
   refused, which stops a page that rebinds its own name to this machine.

`dev:lan` listens on the network for a phone on the same Wi-Fi, and refuses to start
while `DEV_AUTH_USER_ID` is set in the shell or any file the web reads. That check
deliberately does **not** consult `NODE_ENV`: refusing a bind the session would not have
used costs a retyped command, and allowing one it would have is the hole.

That check reads the env files with Node's parser, and Next reads them with its own, so
a line one accepts and the other does not can slip past `dev:lan`. It still fails
closed: `dev:lan` starts without the mark, so if Next does find the id, the config
refuses the dev session.

**The limit of the bind, stated rather than implied.** The mark is a signal the launcher
sets, not a secret. Setting `DEV_SESSION_BIND=loopback` by hand and running
`next dev -H 0.0.0.0` directly — bypassing `pnpm dev` — puts a signed-in dev session on
the network. The config cannot refuse that: Next loads it in a child process started
without arguments, so it never sees `-H`. It takes two deliberate acts and never reaches
production, since the phase lock (1) keeps the stand-ins out of every build. What can be
enforced is: no environment file the template ships ever sets the mark, so it cannot
arrive by copying an example.

Enforced by `test/dev-session/aliases.test.ts` (every phase, the mark),
`test/dev-session/stand-ins.test.ts` (loading under production, the Host),
`test/dev-session/bind.test.ts` and `test/dev-session/serve.test.ts` (the bind, the
arguments, `dev:lan`'s refusal).

## Locales

The contract's `LOCALES` is the list. `messages/` holds exactly one catalogue per locale,
each with the default's keys; the page's locale is the profile's choice, then the
browser's, then the first locale. Changing it is the worked example of the mutation path:
a Server Action parses its input with the contract's schema, calls `lib/api.ts`, and
answers a sentence rather than throwing.

Enforced by `test/messages.test.ts` and `test/app/actions/profile.test.ts`.

## The exemplar

`/` lists `example-item`s: the web half of the API's placeholder context. **Rename it to
your first domain noun, or delete it** — with the API's half.
