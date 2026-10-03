No application code: Docker Compose, POSIX `sh` scripts and one `mongosh` script. MongoDB is pinned to `mongo:8.2.12` in both compose files, as a single-node replica set with a keyfile.

| Part                                       | Runs with                                         |
| ------------------------------------------ | ------------------------------------------------- |
| the local stack                            | `docker compose up -d`                            |
| the production stack, with its backup loop | `docker compose -f docker-compose.prod.yml up -d` |
| before the first deploy                    | `sh scripts/preflight.sh`                         |
| after the stack is up                      | `sh scripts/verify.sh`                            |

The gates need Docker and nothing else: `sh scripts/shellcheck.sh` lints every script, `sh scripts/compose-check.sh` validates both compose files. Configuration is read from `.env`; `.env.example` lists every key.
