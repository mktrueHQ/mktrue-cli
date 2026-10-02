# Security

The rules that keep one user's data away from another, and keep an unconfigured
deployment closed. Every rule names the test that fails if the rule is broken.

## Tenancy: every query names its user

Every owned collection's schema applies `userScopedSchema`
(`contexts/shared/infrastructure/user-scoped-schema.ts`). The plugin adds a required
`userId` path. It also throws `UnscopedQueryError` **before any I/O** for:

- any query operation whose filter does not name a non-empty `userId`, including an
  upsert whose insert would not carry one;
- an aggregate whose first stage is not a `$match` on `userId`;
- a pipeline that writes (`$out`, `$merge`), or a join (`$lookup`, `$graphLookup`,
  `$unionWith`) that does not carry its own scope to the same owner, `$facet` branches
  included;
- a `bulkWrite` containing any operation that does not name its user.

A forgotten scope is therefore a crash, not a leak. The controllers map that crash to a
500 that names nothing. It must never become an empty 200.

`insertMany`, `create` and `save` are not filtered, because they insert rather than
query. The required `userId` path refuses an owner-less document at validation.
`createCollection` has nothing to scope.

Enforced by:

- `test/contexts/shared/infrastructure/user-scoped-schema.test.ts`. It pins the guarded
  operations against Mongoose's own lists, so a Mongoose release that adds an operation
  fails by name.
- `test/app/cross-tenant.test.ts`. Two admitted users probe every route for each other's
  rows.
- `test/app/query-guard-bypass.test.ts`. It sweeps the source for ways around the plugin
  (`.collection`, `bulkWrite`, `middleware:` options, joins and so on). The answer is an
  equality naming the files that may bypass it, and in a fresh service that list is
  empty.
- `test/controllers/map-example-error.test.ts`. An unscoped read answers 500.

## Default-deny

`requireUser` is registered **globally** as an `onRequest` hook, so a route is closed
because it exists. There is no per-route opt-in to forget. It runs at `onRequest`
rather than `preHandler` so that an anonymous caller never reaches body parsing or
validation. A validation error would tell a stranger which fields a gated route needs.

`PUBLIC_ENDPOINTS` in `app/server.ts` is the whole open surface: `GET /health` and
`HEAD /health`. It is keyed on method and route pattern, never the raw URL, so a query
string or trailing slash cannot smuggle a route past it, and opening a path for reading
does not open it for writing. A path that matches no route is never public, so an
anonymous caller gets a 401 rather than a 404 that would reveal which routes exist.
**Adding an entry is a security decision.**

`/health` is public because a container healthcheck runs without a token. It returns
no personal data and no internals.

Enforced by `test/app/server.test.ts`, which pins the list by equality and walks every
registered route in every configuration state, and by
`test/middlewares/require-user.test.ts`.

Every non-public response is sent with `cache-control: no-store`, set once in
`app/server.ts` rather than per route.

## The gate's decision table

| Request                                                         | Answer                  |
| --------------------------------------------------------------- | ----------------------- |
| a public `METHOD /route`                                        | passes, no principal    |
| `OWNER_USER_ID` unset                                           | 503, before the token   |
| no `Authorization: Bearer <token>`                              | 401                     |
| a token the verifier rejects                                    | 401                     |
| a verified principal not on the whitelist                       | 403                     |
| the gate cannot decide (no keys, provider down, anything else)  | 503 `auth_unavailable`  |

No branch reaches a gated handler without a verified, admitted principal. Two facts must
both hold: the token verifies, **and** the principal is on a list this repository
controls. The whitelist is not delegated to the provider's dashboard.

## Fail closed

Blank configuration selects an adapter that refuses. `selectTokenVerifier` builds the
real verifier only when **both** `CLERK_SECRET_KEY` and `CLERK_ISSUER` are set. The
issuer pins which instance a token must come from, so half a pair must not build a real
verifier. Otherwise it selects `NullTokenVerifier`, which refuses every token. The gate
maps that refusal to **503**, and never lets the request through or treats it as the
owner. There is no permissive stub and no fallback secret.

- In production, `parseConfig` refuses to boot without every variable in
  `REQUIRED_IN_PRODUCTION`, and names all the missing ones at once.
- In any other environment a fresh clone runs. `/health` answers 200 with
  `mongo: "disconnected"`, and every gated route answers 503.
- Failures are kept apart. A bad token is a 401: the caller can fix it by signing in
  again. "Cannot decide" is a 503: a better token would not help. Collapsing the two
  would send users around a sign-in loop whenever the provider has an outage.

Enforced by `test/app/config.test.ts`, by the verifier's own suite, and by
`test/app/server.test.ts`. That test sends a bearer token through the gate with an owner
configured and no verifier, and expects 503.

## The whitelist

`ALLOWED_USER_IDS` lists who this deployment admits. `OWNER_USER_ID` is the
administrator. The owner is **always** a member, whatever the list says. A blank list
therefore admits the owner alone. It never widens the door, and it never locks the owner
out of his own deployment. `admittedUserIds` in `app/config.ts` is the only place that
union happens. The gate tests exactly the set it is handed, so an empty set admits
nobody.

A malformed entry refuses to boot. The check looks at the prefix and character class,
not the provider's full alphabet: a stricter check could refuse a legitimate id, while a
looser one can only admit a string no token will ever match.

## Identity: one seam

A handler learns whose rows to read from `callerId(request)` in
`controllers/caller-id.ts`, and from nowhere else. It reads the principal the gate set
and nothing the client sent: no query parameter, body field, route parameter or header.
Reaching it without a principal means the gate did not run. That is a 500, never a read
performed for nobody.

Enforced by `test/app/client-supplied-owner.test.ts`. Exactly two files may obtain an
owner, the seam and the gate, and every `request` read in those two files is pinned.

## The dev session

`DEV_AUTH_USER_ID` lets a local `pnpm dev` accept that id as its own bearer token, so
the UI can be driven without a real sign-in. The token is not a secret, so what keeps it
from being a door is where it can exist. `parseConfig` refuses to boot with it unless:

- `NODE_ENV=development`, exactly. A staging name or a typo is refused;
- `HOST` is a loopback address. A deployed container must listen on `0.0.0.0`;
- the id is already admitted, with `OWNER_USER_ID` set. It never widens the whitelist.

Under a dev session, a request whose `Host` is not a loopback name is refused with 421
before the gate runs. This stops a DNS-rebinding page. 421 is used rather than 403
because a 403 means only one thing in this service: not admitted.

Enforced by `test/app/config.test.ts` and `test/app/server.test.ts`.

## What is never written down

- **No token, and no part of one,** in an error message or a log line.
- **No principal id** in a log line or a refusal. A 403 does not distinguish "not on the
  list" from "the list is empty", which would reveal who is a member.
- **No query string** in a request log. The request line names the route pattern, and
  the query is dropped whole rather than filtered parameter by parameter.
- **No internals** on the wire. An unexpected failure is a 500 with a generic message.
  Only the framework's own validation messages, which come from our schemas, are passed
  on.
- Normal events (a missing token, an unconfigured provider) are not logged loudly.
  Every one of them can be triggered by an anonymous caller, and loud logging would let
  that caller flood the logs.
