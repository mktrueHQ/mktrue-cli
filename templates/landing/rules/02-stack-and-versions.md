TypeScript 5, strict. Node 24 or newer. pnpm 11.1.2, pinned by `packageManager`; `pnpm-lock.yaml` pins every exact version, and Turborepo 2 runs the workspace.

| Part                 | Stack                                             | Runs with                          |
| -------------------- | ------------------------------------------------- | ---------------------------------- |
| `apps/web`           | Next.js 16, React 19, next-intl 4, Tailwind CSS 4 | `pnpm --filter ./apps/web dev`     |
| `services/api`       | Fastify 5, Mongoose 9, zod 3, Resend 4            | `pnpm --filter ./services/api dev` |
| `packages/contracts` | zod 3 schemas, no build step                      | imported by both                   |

`pnpm dev` runs both parts. Tests are Vitest 3, with MongoDB from `mongodb-memory-server` in the service: `pnpm test` runs them all. `pnpm typecheck`, `pnpm lint` (ESLint 9), `pnpm format:check` (Prettier 3) and `pnpm build` cover the workspace. The web reaches the service only through `API_BASE_URL`, which has no default: blank, the request flow is off. Configuration is read from `.env`; `.env.example` lists every key.
