| Path                                      | What                                                          |
| ----------------------------------------- | ------------------------------------------------------------- |
| `packages/contracts/`                     | every shape that crosses a boundary, as zod schemas           |
| `services/api/src/app/`                   | config, the composition root, the process entry               |
| `services/api/src/contexts/<name>/`       | one domain each: `domain/`, `application/`, `infrastructure/` |
| `services/api/src/contexts/shared/`       | the kernel any context may import                             |
| `services/api/src/controllers/`           | thin HTTP handlers                                            |
| `services/api/src/middlewares/`           | the gate and the error envelope                               |
| `services/api/test/`                      | mirrors `src/`                                                |
| `docs/architecture.md` `docs/security.md` | the rules the service holds, each with its test               |
| `docs/`                                   | state, roadmap, decisions, design, log                        |
| `.prettierrc.json` `.prettierignore`      | what `pnpm format` holds the code to                          |

A new domain is a new context. A new kind of file needs a line here first.
