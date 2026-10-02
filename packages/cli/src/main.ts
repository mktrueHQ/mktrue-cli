import { parseArgs } from "node:util";

import { EXIT, type ExitCode } from "@mktrue/core";

import { runAudit } from "./commands/audit.js";
import { runCheck } from "./commands/check.js";
import { runDoctor } from "./commands/doctor.js";
import { runImport } from "./commands/import.js";
import { runNew } from "./commands/new.js";
import { runCheckSiblings } from "./commands/siblings.js";
import { runSync } from "./commands/sync.js";
import type {
  AuditPorts,
  DoctorPorts,
  FileSystem,
  NewPorts,
  OpenBench,
  OpenRepository,
  Output,
  ReadOnlyFileSystem,
  SiblingPorts,
} from "./ports.js";
import { loadRepo } from "./repo.js";
import { COLUMNS, clip, errorCode, internalError, refuse } from "./report.js";
import { refuseUnsafeShell, UnsafeShellArgument } from "./spawn.js";

export const KIT_VERSION = "0.3.0";

const USAGE = `mktrue <command>

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
  --help
`;

/** The exit for whatever `main` throws: a refused shell argument is exit 3, anything else a crash. */
export function exitOnThrow(out: Output, error: unknown): ExitCode {
  return error instanceof UnsafeShellArgument
    ? refuseUnsafeShell(out, error)
    : internalError(out, error);
}

export async function main(
  argv: readonly string[],
  fs: FileSystem,
  out: Output,
  bench?: FileSystem | OpenBench,
  openRepository?: OpenRepository,
  newPorts?: NewPorts,
  doctorPorts?: DoctorPorts,
  auditPorts?: AuditPorts,
  siblingPorts?: SiblingPorts,
): Promise<ExitCode> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
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
      },
    });
  } catch (error) {
    out.line(clip(`mktrue: ✗ usage · an argument was refused: ${errorCode(error)}`, COLUMNS));
    out.line(USAGE);
    return EXIT.USAGE;
  }

  const command = parsed.positionals[0];
  const benchFs = typeof bench === "function" ? bench(parsed.values.bench) : bench;

  if (parsed.values.help === true || command === undefined) {
    out.line(USAGE);
    return command === undefined && parsed.values.help !== true ? EXIT.USAGE : EXIT.TRUE;
  }

  if (command === "new") {
    return runNewCommand(parsed.positionals, parsed.values, out, benchFs, newPorts);
  }

  if (command === "doctor") {
    return runDoctorCommand(parsed.values, out, doctorPorts);
  }

  if (command === "audit") {
    return runAuditCommand(parsed.positionals, parsed.values, out, auditPorts);
  }

  const repo = await loadRepo(fs, benchFs);

  switch (command) {
    case "check":
      if (parsed.values.siblings !== true) return runCheck(repo, out, KIT_VERSION);
      if (siblingPorts === undefined) {
        return refuse(
          out,
          "environment",
          "check --siblings cannot read another repository here",
          "nothing supplied a way to read a sibling's git history",
          "run check --siblings from the installed mktrue binary",
          EXIT.ENVIRONMENT,
        );
      }
      return runCheckSiblings(repo, fs, out, siblingPorts, {
        kitVersion: KIT_VERSION,
        target: parsed.values.target ?? "claude-code",
        json: parsed.values.json === true,
      });
    case "sync":
      return runSync(repo, fs, out, {
        write: parsed.values.write === true,
        adopt: parsed.values.adopt === true,
        restore: parsed.values.restore === true,
        kitVersion: KIT_VERSION,
        target: parsed.values.target ?? "claude-code",
      });
    case "import":
      return runImportCommand(parsed.values, fs, out, openRepository);
    default:
      out.line(clip(`mktrue: ✗ usage · there is no command "${command}"`, COLUMNS));
      out.line(USAGE);
      return EXIT.USAGE;
  }
}

async function runImportCommand(
  values: {
    from?: string | undefined;
    template?: string | undefined;
    write?: boolean | undefined;
    "adopt-template"?: boolean | undefined;
  },
  fs: FileSystem,
  out: Output,
  openRepository?: OpenRepository,
): Promise<ExitCode> {
  if (values.from === undefined || values.template === undefined) {
    return refuse(
      out,
      "usage",
      "import needs --from <dir> and --template <name>",
      "it lifts one named template out of one named product, guessing neither",
      "mktrue import --from ../strafe-landing --template landing",
      EXIT.USAGE,
    );
  }
  if (values.write === true && values["adopt-template"] === true) {
    return refuse(
      out,
      "usage",
      "import takes --write or --adopt-template, not both",
      "one records what the curation already claims; the other acts on it",
      "adopt first, read the plan it makes possible, then run --write",
      EXIT.USAGE,
    );
  }
  if (openRepository === undefined) {
    return refuse(
      out,
      "environment",
      "import cannot open another repository here",
      "nothing supplied a way to read a second repository, so --from is idle",
      "run import from the installed mktrue binary",
      EXIT.ENVIRONMENT,
    );
  }

  let source: ReadOnlyFileSystem;
  try {
    source = await openRepository(values.from);
  } catch (error) {
    return refuse(
      out,
      "import",
      `--from was refused: ${errorCode(error)}`,
      "import reads a second repository by path, so the path is checked first",
      "pass --from a real directory holding a .mktrue.json",
      EXIT.USAGE,
    );
  }

  return runImport(fs, source, out, {
    template: values.template,
    write: values.write === true,
    adoptTemplate: values["adopt-template"] === true,
  });
}

async function runAuditCommand(
  positionals: readonly string[],
  values: { out?: string | undefined; json?: boolean | undefined },
  out: Output,
  auditPorts?: AuditPorts,
): Promise<ExitCode> {
  if (positionals.length > 1) {
    return refuse(
      out,
      "usage",
      "audit takes no arguments, only --out <file> or --json",
      "it always measures the repository it runs in",
      "mktrue audit",
      EXIT.USAGE,
    );
  }
  if (auditPorts === undefined) {
    return refuse(
      out,
      "environment",
      "audit cannot read transcripts here",
      "nothing supplied a transcript store or a runner, so audit has nothing to read",
      "run audit from the installed mktrue binary",
      EXIT.ENVIRONMENT,
    );
  }
  return runAudit(auditPorts, out, { out: values.out, json: values.json === true });
}

async function runDoctorCommand(
  values: { write?: boolean | undefined },
  out: Output,
  doctorPorts?: DoctorPorts,
): Promise<ExitCode> {
  if (doctorPorts === undefined) {
    return refuse(
      out,
      "environment",
      "doctor cannot inspect this machine here",
      "nothing supplied a runner or a machine port, so doctor has nothing to probe",
      "run doctor from the installed mktrue binary",
      EXIT.ENVIRONMENT,
    );
  }
  return runDoctor(doctorPorts, out, { write: values.write === true });
}

async function runNewCommand(
  positionals: readonly string[],
  values: {
    answers?: string | undefined;
    offline?: boolean | undefined;
    target?: string | undefined;
    bench?: string | undefined;
  },
  out: Output,
  benchFs?: FileSystem,
  newPorts?: NewPorts,
): Promise<ExitCode> {
  const [, template, name, ...extra] = positionals;
  if (template === undefined || name === undefined || extra.length > 0) {
    return refuse(
      out,
      "usage",
      "new takes a template, a name, --answers <file>, or a terminal",
      "the name is on the command line so the tree is never a surprise",
      "mktrue new application ledger --answers answers.json",
      EXIT.USAGE,
    );
  }
  if (newPorts === undefined) {
    return refuse(
      out,
      "environment",
      "new cannot run programs or make directories here",
      "nothing supplied a workspace or a runner, so new has nowhere to build",
      "run new from the installed mktrue binary",
      EXIT.ENVIRONMENT,
    );
  }
  return runNew(values.bench === undefined ? undefined : benchFs, newPorts, out, {
    template,
    name,
    answers: values.answers,
    offline: values.offline === true,
    kitVersion: KIT_VERSION,
    target: values.target ?? "claude-code",
    bench: values.bench,
  });
}
