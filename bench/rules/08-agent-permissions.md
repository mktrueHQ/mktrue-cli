## 8 · What agents may and may not do

<!-- Owned by this repository. mktrue renders this heading and never touches what follows. -->

Configuration enforces this, not trust: `.claude/settings.json` carries the rules, and `mktrue check` reports when they go missing.

Never: read secret files, force-push, rewrite published history, commit to `main` directly, install a dependency without a decision entry, or send this repository's contents anywhere.

Add what else is out of bounds here.
