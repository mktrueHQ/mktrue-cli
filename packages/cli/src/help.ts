export const OPTIONS = {
  write: { type: "boolean", default: false },
  adopt: { type: "boolean", default: false },
  restore: { type: "boolean", default: false },
  "adopt-template": { type: "boolean", default: false },
  target: { type: "string", default: "claude-code" },
  bench: { type: "string" },
  from: { type: "string" },
  template: { type: "string" },
  answers: { type: "string" },
  offline: { type: "boolean", default: false },
  out: { type: "string" },
  json: { type: "boolean", default: false },
  siblings: { type: "boolean", default: false },
  help: { type: "boolean", default: false },
} as const;

export type OptionName = keyof typeof OPTIONS;

export const COMMANDS = ["doctor", "new", "check", "sync", "import", "audit"] as const;

export type Command = (typeof COMMANDS)[number];

export function isCommand(value: string | undefined): value is Command {
  return (COMMANDS as readonly string[]).includes(value ?? "");
}

/** The flags each command reads; `--help` is read by all of them. */
export const COMMAND_FLAGS: Record<Command, readonly OptionName[]> = {
  doctor: ["write"],
  new: ["answers", "offline", "target", "bench"],
  check: ["siblings", "json", "target", "bench"],
  sync: ["write", "adopt", "restore", "target", "bench"],
  import: ["from", "template", "write", "adopt-template"],
  audit: ["out", "json"],
};

export const USAGE = `mktrue <command>

  doctor [--write]
                   does this machine have what new and the skill need;
                   --write makes exactly one change, the skill link
  new <template> <name> [--answers <file>]
                   make ./<name> from application, api-service, landing or
                   infrastructure, verified and committed; --offline renders
                   it without either. Without --answers, new asks its
                   questions in a terminal
  check            is this repository still true
  check --siblings [--json]
                   also compare each answers.siblings repository, read at
                   its baseBranch through local git, with this one
  sync [--write]   bring the method up to date; a dry run unless --write
  sync --adopt     take the kit's version of files never under management
  sync --restore   put back a kit-owned file this repository deleted
  import           lift a template's files out of a product; a dry run
                   unless --write
  audit [--out <file>] [--json]
                   measure this repository's local Claude Code transcripts
                   into one HTML report; sends nothing. --json prints the
                   report to stdout and writes no file
  import --adopt-template  record the template's baseline; writes no file

  --from <dir>     the product to import from, under the method (import)
  --template <n>   the template to import into (import)

  --answers <file> the answers to render from, as JSON (new)
  --target <name>  the agent target to render for (default: claude-code)
  --bench <dir>    the kit to render from (default: installed; new: embedded)
  --help           this screen; mktrue <command> --help for one command's
                   flags and exit codes
`;

export const HELP: Record<Command, string> = {
  doctor: `mktrue doctor [--write]

  Does this machine have what new and the skill need. It checks Node, git
  and its identity, pnpm, that this mktrue is the one on PATH, the skill
  link, Docker, Claude Code and the default model. It reads only; it never
  touches settings.json, hooks or PATH.

  flags
    --write          make exactly one change: link the skill the package
                     carries at <config>/skills/mktrue. It replaces only a
                     link of its own, and deletes nothing
    --help           this screen

  exit codes
    0  this machine is ready
    1  the default model is a 1M-context variant
    3  Node 24, git, its identity, pnpm 11, mktrue on PATH or the skill
       link is missing
    4  --write found something that is not its own link in the way
`,
  new: `mktrue new <template> <name> [--answers <file>] [--offline]

  Make ./<name> from a template: application, api-service, landing or
  infrastructure. new renders the tree beside the target, runs the
  template's own gates and mktrue check on it, commits it on main under
  your git identity, and only then moves it into place. Without --answers
  it asks its questions in a terminal.

  flags
    --answers <file> the answers to render from, as JSON; nothing is asked
    --offline        render without installing, running the gates or
                     committing; nothing is fetched
    --target <name>  the agent target to render for (default: claude-code)
    --bench <dir>    a kit checkout to render from (default: the embedded
                     copy)
    --help           this screen

  exit codes
    0  ./<name> is true; with --offline, rendered and not verified; or the
       questions were cancelled and nothing was written
    1  the bench or the template is broken, or a gate failed: the tree is
       kept beside a log and nothing is moved into place
    2  usage: a template new does not offer, a name or an answer that is
       refused, answers that cannot be read, or no terminal to ask in
    3  git, its identity, pnpm or Docker is missing
    4  ./<name> already exists and is not an empty directory
`,
  check: `mktrue check [--siblings [--json]]

  Is this repository still true. check reads the document budgets, the
  bench's integrity, the role tiers, the document paths, the gates
  .mktrue.json lists, the deny rules of the settings file and the drift
  of every kit-owned file. It writes nothing and sends nothing.

  flags
    --siblings       also compare each repository answers.siblings names,
                     read at its base branch through local git: no fetch,
                     no checkout, no write
    --json           with --siblings, print the report alone, as JSON
    --target <name>  with --siblings, the agent target to compare for
                     (default: claude-code)
    --bench <dir>    a kit checkout to check against (default: the
                     installed kit)
    --help           this screen

  exit codes
    0  true
    1  findings: a budget, the bench, a role tier, a path, no gates
       listed, the settings file or drift; with --siblings, a sibling
       that diverges
    2  .mktrue.json does not parse; with --siblings, there is no
       .mktrue.json or no bench to compare with
    3  with --siblings, a listed sibling cannot be read
`,
  sync: `mktrue sync [--write] [--adopt] [--restore]

  Bring the method up to date: the kit-owned files and the kit's region of
  the rules file. sync compares what the kit renders now with the hashes
  the last render recorded, so an edit of yours is kept, never overwritten.
  The settings file is written only when there is none. A dry run unless
  --write.

  flags
    --write          apply the plan, and record it in .mktrue.json
    --adopt          take the kit's version of a file it never managed here
    --restore        put back a kit-owned file this repository deleted
    --target <name>  the agent target to render for (default: claude-code)
    --bench <dir>    a kit checkout to render from (default: the installed
                     kit)
    --help           this screen

  exit codes
    0  true: nothing to do, or the plan holds no finding
    1  findings, .mktrue.json lists no gates, or a write failed before
       anything moved
    2  there is no .mktrue.json or no bench, or .mktrue.json does not parse
    4  a decision is needed: a file changed in both the kit and this
       repository. With --write the kit's version is saved beside it as
       <path>.mktrue-next
`,
  import: `mktrue import --from <dir> --template <name> [--write | --adopt-template]

  Lift a template's files out of a living product, back into
  templates/<name> of the kit checkout it runs in. This is how the kit
  refreshes a template; a product never needs it. A dry run unless --write.

  flags
    --from <dir>     the product to import from: a directory holding a
                     .mktrue.json
    --template <name>
                     the template to import into
    --write          apply the plan: write the lifted files and record
                     them in template.json. Nothing is committed
    --adopt-template record the template's present files as the baseline;
                     writes no file but template.json
    --help           this screen

  exit codes
    0  true
    1  findings: a refusal such as a secret, a file the template does not
       have, or a write that failed before anything moved
    2  usage: --from or --template is missing or refused, --write with
       --adopt-template, or a manifest that does not parse
    4  a decision is needed: a file has no baseline, or changed on both
       sides
`,
  audit: `mktrue audit [--out <file>] [--json]

  Measure what this repository's agent sessions cost. audit reads the local
  Claude Code transcripts of this repository and its worktrees and writes
  one HTML report. It sends nothing, and it is never a gate.

  flags
    --out <file>     where the report goes (default:
                     <git common dir>/mktrue/audit-<date>.html)
    --json           print the report to stdout as JSON and write no file;
                     not with --out
    --help           this screen

  exit codes
    0  a report was produced
    2  usage: an argument, --out with --json, --out naming a link or a
       directory, or not inside a git repository
    3  no transcripts for this repository, or the report could not be
       written
`,
};
