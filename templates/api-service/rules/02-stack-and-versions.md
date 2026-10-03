TypeScript 5, strict. Node 24 or newer. pnpm 11.1.2, pinned by `packageManager`; `pnpm-lock.yaml` pins every exact version, and Turborepo 2 runs the workspace.

| Part                 | Stack                                            | Runs with                          |
| -------------------- | ------------------------------------------------ | ---------------------------------- |
| `services/api`       | Fastify 5, Mongoose 9, zod 3, `@clerk/backend` 3 | `pnpm --filter ./services/api dev` |
| `packages/contracts` | zod 3 schemas, no build step                     | imported by the service            |

Tests are Vitest 4, with MongoDB from `mongodb-memory-server`: `pnpm test` runs them all, `pnpm --filter ./services/api test` runs one part. `pnpm typecheck`, `pnpm format:check` (Prettier 3) and `pnpm build` (tsup) cover the workspace. Configuration is read from `.env`; `.env.example` lists every key.
