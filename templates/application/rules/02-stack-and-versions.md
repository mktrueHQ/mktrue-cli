TypeScript 5, strict. Node 24 or newer. pnpm 11.1.2, pinned by `packageManager`; `pnpm-lock.yaml` pins every exact version, and Turborepo 2 runs the workspace.

| Part                 | Stack                                                                | Runs with                          |
| -------------------- | -------------------------------------------------------------------- | ---------------------------------- |
| `apps/web`           | Next.js 16, React 19, next-intl 4, Tailwind CSS 4, `@clerk/nextjs` 7 | `pnpm --filter ./apps/web dev`     |
| `services/api`       | Fastify 5, Mongoose 9, zod 3, `@clerk/backend` 3                     | `pnpm --filter ./services/api dev` |
| `packages/contracts` | zod 3 schemas, no build step                                         | imported by both                   |

`pnpm dev` runs both parts. Tests are Vitest 4, with MongoDB from `mongodb-memory-server` in the service: `pnpm test` runs them all. `pnpm typecheck`, `pnpm format:check` (Prettier 3) and `pnpm build` cover the workspace. The web reaches the service only through `API_BASE_URL`, which has no default: blank, every call is refused, and `.env.example` sets it to the service's development port. Configuration is read from `.env`; `.env.example` lists every key.
