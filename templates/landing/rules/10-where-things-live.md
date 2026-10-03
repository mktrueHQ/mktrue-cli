| Path                                                     | What                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| `apps/web/app/[locale]/`                                 | the pages, one tree per language                             |
| `apps/web/app/api/`                                      | the routes that pass a form to the service                   |
| `apps/web/app/components/`                               | what the pages are built from                                |
| `apps/web/lib/`                                          | configuration, SEO, the service client                       |
| `apps/web/i18n/` `apps/web/messages/`                    | locale routing, and one message catalogue per language       |
| `packages/contracts/`                                    | every shape that crosses a boundary, as zod schemas          |
| `services/api/src/app/`                                  | config, the composition root, the process entry              |
| `services/api/src/contexts/access-request/`              | the one domain: `domain/`, `application/`, `infrastructure/` |
| `services/api/src/controllers/` `middlewares/`           | thin HTTP handlers; the error envelope                       |
| `apps/web/test/` `services/api/test/`                    | each mirrors its source tree                                 |
| `docs/`                                                  | state, roadmap, decisions, design, log                       |
| `.prettierrc.json` `.prettierignore` `eslint.config.mjs` | what `pnpm format` and `pnpm lint` hold the code to          |

The web never reads the database: it calls the service. A new kind of file needs a line here first.
