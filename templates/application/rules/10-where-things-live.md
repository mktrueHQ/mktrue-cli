| Path                                                    | What                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| `apps/web/app/`                                         | routes, server actions and components                         |
| `apps/web/lib/`                                         | what the routes call: configuration and the API client        |
| `apps/web/i18n/` `apps/web/messages/`                   | locale routing, and one message catalogue per language        |
| `apps/web/dev-session/`                                 | the development server and its stand-in session               |
| `apps/web/proxy.ts`                                     | the request gate: default-deny for pages                      |
| `packages/contracts/`                                   | every shape that crosses a boundary, as zod schemas           |
| `services/api/src/app/`                                 | config, the composition root, the process entry               |
| `services/api/src/contexts/<name>/`                     | one domain each: `domain/`, `application/`, `infrastructure/` |
| `services/api/src/controllers/` `middlewares/`          | thin HTTP handlers; the gate and the error envelope           |
| `apps/web/test/` `services/api/test/`                   | each mirrors its source tree                                  |
| `docs/architecture.md` `docs/security.md` `docs/web.md` | the rules each half holds                                     |
| `docs/`                                                 | state, roadmap, decisions, design, log                        |
| `.prettierrc.json` `.prettierignore`                    | what `pnpm format` holds the code to                          |

The web never reads the database: it calls the service. A new kind of file needs a line here first.
