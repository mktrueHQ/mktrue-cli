| Path                                                | What                                              |
| --------------------------------------------------- | ------------------------------------------------- |
| `docker-compose.yml`                                | the local stack: one MongoDB                      |
| `docker-compose.prod.yml`                           | the production stack: MongoDB and the backup loop |
| `mongo/mongod.conf`                                 | the server's configuration                        |
| `scripts/bootstrap-users.sh` `bootstrap-users.js`   | one database and one user per consumer            |
| `scripts/init-replica-set.sh` `generate-keyfile.sh` | first-boot setup                                  |
| `scripts/backup-loop.sh` `restore.sh`               | backups, and the way back                         |
| `scripts/preflight.sh` `verify.sh`                  | checks before a deploy and after one              |
| `scripts/shellcheck.sh` `compose-check.sh`          | the gates                                         |
| `scripts/_mongo.sh`                                 | what the other scripts share                      |
| `.github/workflows/ci.yml`                          | the gates, on every push                          |
| `docs/`                                             | state, roadmap, decisions, design, log            |

A new consumer is an answer, not a file: it lands in `.env.example` and the bootstrap. A new kind of file needs a line here first.
