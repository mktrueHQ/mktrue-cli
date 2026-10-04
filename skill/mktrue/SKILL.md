---
name: mktrue
description: Turn one sentence describing a product idea into a repository mktrue can build without drifting. Use when the founder wants to start a new product, API service, landing page or shared infrastructure, or asks to "make it true".
---

# mktrue

This skill gets the answers `mktrue new` asks for from a conversation, then
runs `new` as a person would. It never renders a file itself, and never
re-implements a check `new` runs: the terminal, the git identity, the answers
schema, the region-marker refusal.

## Steps

1. **Find the CLI.** Run `mktrue --help`. If it fails, stop and print:

   ```
   npm i -g mktrue
   mktrue doctor --write
   ```

2. **Read the sentence.** Propose the template (`application`,
   `api-service`, `landing` or `infrastructure`; `application` when none of
   the other three fits), a name matching `^[a-z][a-z0-9-]*$`, the purpose
   and the data classes.

3. **One round.** Ask every question in the table below at once, proposals
   and defaults filled in. The founder confirms every answer in this round.

4. **Write the answers file**, `answers.json`, with the Write tool, into a
   fresh `mktemp -d` directory, never inside the target directory.

5. **Run**, in the directory the founder chose to build in:

   ```
   mktrue new <template> <name> --answers <file>
   ```

   `<template>` is one of the four literals `application`, `api-service`,
   `landing` or `infrastructure`, never built from the sentence. Pass the
   name quoted, only once it matches the pattern. No answer text and no part
   of the sentence reaches the shell: answers go through the answers file.

6. **Relay** the CLI's lines and exit code, unchanged. On exit 2, fix the
   answer it named and run again. On exit 3 or 4, stop and relay its fix
   line; never run it yourself, edit a global setting, or delete anything in
   the founder's way. Never edit the rendered tree by hand. On every exit,
   remove the temporary directory with
   `rm -r -- "<the exact path mktemp printed>"`, never a rebuilt path.

7. **Hand off.** On exit 0, tell the founder to open a fresh Claude Code
   session in `./<name>` and run `/create-roadmap` there, starting from their
   sentence. This skill does not run it.

## Reference

### The templates

- `application`: a product people use through a web interface, with its API.
- `api-service`: an API with no interface of its own.
- `landing`: a public page that presents a product and takes access requests.
- `infrastructure`: the database and private network products share.

### The questions

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
`landing` asks `title` instead of either port, defaulting to the name with
each hyphen-separated word capitalised (`strafe-landing` -> `Strafe Landing`);
`infrastructure` asks `consumers`, the comma-separated product slugs it
serves, instead of either port. `landing` and `infrastructure` have no
sign-in: `auth` is not asked, and is written `none`. A blank `dataClasses`
reply is `[]`.

### The answers file

Top-level strings, except `ports` (an object) and `dataClasses`,
`languages`, `siblings`, `skills` (arrays; the last two always `[]`):

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
