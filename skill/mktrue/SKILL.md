---
name: mktrue
description: Turn one sentence describing a product idea into a repository mktrue can build without drifting. Use when the founder wants to start a new product, app, or api-service, or asks to "make it true".
---

# mktrue

`mktrue new` renders a repository from answers to a fixed set of questions.
This skill gets those answers from a conversation instead of a terminal, then
runs the same command a person would type. It never renders anything itself.

## Steps

1. **Find the CLI.** Run `mktrue --help`. If it fails, stop and print:

   ```
   ln -s <kit>/packages/cli/dist/mktrue.js ~/.local/bin/mktrue
   mktrue doctor --write
   ```

2. **Read the sentence.** From what the founder wrote, propose:
   - the template: `application` unless the sentence describes an API with
     no interface of its own, in which case `api-service`
   - a name matching `^[a-z][a-z0-9-]*$`
   - the purpose and the data classes it holds

3. **One round.** Ask every question below at once, in the chat, with the
   proposals and the defaults filled in. This list and its defaults are the
   same ones `mktrue new` asks in a terminal; a kit test checks the two do
   not drift.

   | Key            | Label     | Default |
   | -------------- | --------- | ------- |
   | `purpose`      | purpose   | —       |
   | `owner`        | owner     | —       |
   | `audienceTest` | audience  | —       |
   | `stakes`       | stakes    | —       |
   | `dataClasses`  | data      | —       |
   | `auth`         | sign-in   | `clerk` |
   | `languages`    | languages | `en`    |
   | `consumers`    | consumers | —       |
   | `title`        | title     | —       |
   | `ports.web`    | web port  | `4100`  |
   | `ports.api`    | api port  | `4101`  |

   `application` asks all nine; `api-service` leaves `ports.web` out;
   `landing` asks `title` instead of either port, its default the name with
   each hyphen-separated word capitalised (`strafe-landing` ->
   `Strafe Landing`); `infrastructure` asks `consumers` instead of either
   port, the products this instance serves as comma-separated slugs.
   `siblings` and `skills` are always `[]`. A blank `dataClasses` reply
   means none, so `[]` is a valid answer there. The founder confirms every
   answer in this one round, not turn by turn.

4. **Write `answers.json`** with the Write tool, into a fresh directory
   made with `mktemp -d`. Never write it inside the target directory. Every
   key in the table above is a top-level string except `ports`, an object,
   and `dataClasses`/`languages`, arrays; `siblings` and `skills` are `[]`:

   ```json
   {
     "name": "ledger",
     "purpose": "...",
     "owner": "...",
     "ports": { "api": 4101, "web": 4100 },
     "dataClasses": ["money"],
     "languages": ["en"],
     "siblings": [],
     "skills": []
   }
   ```

5. **Run**, in the directory the founder chose to build in:

   ```
   mktrue new <template> <name> --answers <file>
   ```

   `<template>` is one of the two literals `application` or `api-service`,
   never built from the sentence. Use the name only after it matches the
   pattern above, and pass it quoted. No answer text, and no part of the
   sentence, ever reaches the shell: every answer goes through the file the
   CLI reads.

6. **Relay** the CLI's own lines and exit code, unchanged. On exit 2, fix
   the one answer it named and run again. On exit 3 or exit 4, stop and
   relay the CLI's own fix line to the founder; never run it yourself, edit
   a global setting, or delete anything in the founder's way. Never edit the
   rendered tree by hand, whatever the CLI said. On every exit, remove the
   temporary directory with `rm -r -- "<the exact path mktemp printed>"`,
   never a path rebuilt from a variable.

7. **Hand off.** On exit 0, tell the founder to open a fresh Claude Code
   session in `./<name>` and run `/create-roadmap` there, with their
   original sentence as a place to start. This skill does not run it.

## What this skill never does

- Never renders a file, writes into the target, or edits what `new` made.
- Never re-implements a check `new` already runs: the terminal check, the
  git identity, the answers schema, the region-marker refusal.
- Never puts an answer, or the founder's sentence, on the command line.
