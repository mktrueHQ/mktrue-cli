## 8 · What agents may and may not do

<!-- Owned by this repository. mktrue renders this heading and never touches what follows. -->

Never: read secret files, force-push, rewrite published history, commit to `main` directly, install a dependency without a decision entry, or send this repository's contents anywhere.

Configuration enforces the first three as far as a rule can name them. `.claude/settings.json` denies reading `.env` and `.env.*` (`.env.example`, `.env.sample` and `.env.template` stay readable) and the key files `*.pem`, `*.key`, `*.p12`, `id_rsa`, `id_ecdsa` and `id_ed25519`; `source` and `.` of `.env` and of a file ending in `.env`, `.env.local` or `.env.production`; `git push` with `--force`, `-f`, a `+` refspec, `--mirror` or `--delete`; `git reset --hard`, `git filter-branch` and `git filter-repo`. `mktrue check` reports when one of those rules goes missing or a `!` rule reopens one. It does not stop a command spelled another way (`git push -uf`, `git -C . push --force`, `source .env.staging`), a file outside the working directory, or a script that opens a secret itself. The other three are rules an agent follows: nothing enforces them but this file.
