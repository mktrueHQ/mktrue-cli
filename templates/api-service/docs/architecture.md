# Architecture

How `services/api` is shaped, and the rules that shape it. Security rules are in
[security.md](security.md). Every rule here is enforced by a test, named beside it. The
test is what keeps the rule in place. This page explains why the rule exists.

## Layout

```
packages/contracts     every shape that crosses a boundary, as zod schemas
services/api/src
  app/                 config, composition root, process entry
  contexts/<name>/     one domain each: domain/, application/, infrastructure/
  contexts/shared/     the kernel any context may import; it imports none of them
  controllers/         thin HTTP handlers
  middlewares/         the gate and the error envelope
services/api/test      mirrors src/, and reaches it through the @api alias
```

- **A context never imports another context.** `domain/` holds entities and their
  rules. `application/` holds one file per use case and the `ports.ts` those use cases
  are written against. `infrastructure/` holds the adapters that answer the ports.
- **Controllers are thin.** Parse with a contract schema, call one use case, map the
  error in the context's `map-*-error.ts`, return a DTO.
- **`app/server.ts` is the composition root**, and it is the only place a concrete
  adapter is chosen. No controller and no middleware reads configuration.
- **`app/config.ts` is the only reader of `process.env`.** `parseConfig(env)` is pure
  and exported, so a test passes a synthetic environment instead of mutating the process.
- **`app/main.ts` is the only place that connects to anything.** Building a server
  never connects, so every route test runs with no database.

## Ports put the owner first

Every method of a storage port takes `userId` as its **first, required** parameter. It
is never optional and never inside an options object: a scope that can be left off the
end of a signature will be left off, and no type makes `find({})` illegal.

Enforced by `test/app/owner-first-ports.test.ts`. It uses a compile-time assertion, and
it reads the first parameter of each port declaration and each adapter method, because
the compiler cannot tell two `string` arguments apart. When a context adds a storage
port, add it to `OWNED_PORTS` in that test. Any other interface declared in a `ports.ts`
goes on `NOT_A_STORAGE_PORT`.

A read-only port stays read-only. `countByStatus` answers counts and nothing else.
Widening it to return rows would put content on a surface whose argument is that it
carries none.

## The owner never reaches a DTO

Entities do not hold a `userId`. The owner enters at the gate, lives on the stored shape
(`UserScoped<Stored…>`, added by the tenancy plugin) and nowhere else. A mapper has
nowhere to read an owner from, so no response can carry one by accident.

## One clock per user

The server is the only clock: a browser's zone is never consulted. But the clock is
read **per caller**. Each user's IANA zone lives in their profile, and
`DEFAULT_TIMEZONE` stands in only for someone who never chose one. A service that dates
every row in one person's zone gives everyone else the wrong day for part of every day,
and nothing fails.

- `controllers/caller-clock.ts` is the one place a route resolves today, so no two
  routes can resolve it differently. Use cases take today as an input and stay pure.
- A profile storage failure is not treated as "never chosen". It propagates as a 503,
  because answering an outage with the default zone would date a row wrongly and say
  nothing.
- Civil dates are `YYYY-MM-DD` strings. `contexts/shared/domain/civil-date.ts` is the
  only place an instant becomes a civil date. Day arithmetic works on the calendar, never
  in 24-hour steps.

Enforced by `test/app/cross-tenant.test.ts` (two users in opposite zones get different
days) and `test/contexts/profile/application/resolve-time-zone.test.ts`.

## One person's read-modify-writes, one at a time

A count-then-write for one user runs inside `serializeByUser`. Without it, two
concurrent requests both count 49, both write, and the ceiling is exceeded. The
exclusion is **per user**, so one person never waits behind another.

- The composition root builds **one** instance per server and hands it to every use case
  that needs it. A second instance would typecheck, run and exclude nothing.
- A failed run reports its error to its own caller and does not block the next run.
- The bound is **per process**. Two processes are two locks. When that matters, the
  lock belongs in the database.

Enforced by `test/app/serialize-by-user.test.ts` and
`test/controllers/example-items/notes.test.ts`, which races two writes at the route.

## Profiles are not admission

A profile holds preferences: a locale and a time zone, each of which may be absent.
Absent means never chosen. It never means the first locale, and it is never stored as
`null`. The gate never reads a profile. A user with no profile is an ordinary admitted
user.

Enforced by `test/app/profile-is-not-admission.test.ts`.

The locale list exists twice: in the contract, and in the domain, which imports no
framework. `test/contexts/profile/domain/enum-drift.test.ts` holds them equal. Neither
list is written as a Mongoose `enum`, because Mongoose copies a rejected value into its
error message.

## Errors

- Every failure is answered in the one envelope `packages/contracts/src/api-error.ts`
  defines. That includes the framework's own 404s and validation failures.
- **A row that is not yours is a 404, never a 403.** Every read is scoped by owner, so
  "not yours" and "not there" are the same answer. A 403 would reveal that the id exists.
  The only 403 is the gate's refusal of a principal who is not admitted.
- A storage outage is a 503, never a 500 and never an empty 200.
- A stored row the domain refuses is a 500: it is our data problem, not the caller's.
- A 409 means the request is valid and the current state forbids it.
- Domain errors carry field and reason pairs, never values.

## `contexts/example` is a placeholder

`ExampleItem` and `ExampleNote` are not a feature. They show the whole convention end to
end, so the first real context is copied from something that works: two entities, a
`ports.ts`, one file per use case, Mongoose adapters, a thin controller directory, and
the tests for all of it. The reference check in `add-example-note.ts` is a scoped read,
not an ownership comparison, so there is no comparison to get wrong.

**Rename it to your first domain noun, or delete it.** The guard suites in `test/app/`
walk whatever contexts exist. They do not depend on the exemplar.
