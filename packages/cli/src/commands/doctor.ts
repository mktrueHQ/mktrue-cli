import { dirname, join } from "node:path";

import {
  EXIT,
  REQUIRED_PNPM,
  exitCodeFor,
  isOneMillionModel,
  nodeSatisfies,
  pnpmSatisfies,
  type ExitCode,
  type Finding,
} from "@mktrue/core";

import { checkEnvironment } from "../environment.js";
import { templatesPnpmPin } from "../pnpm-pin.js";
import type { DoctorPorts, Output } from "../ports.js";
import { clip, COLUMNS, printable } from "../report.js";

export interface DoctorOptions {
  readonly write: boolean;
}

const WHAT_BUDGET = COLUMNS - "mktrue: ✗ doctor · ".length;
const WHY_BUDGET = COLUMNS - "  why   ".length;
const FIX_BUDGET = COLUMNS - "  fix   ".length;

const doctorFinding = (what: string, why: string, fix: string, exit: ExitCode): Finding => ({
  gate: "doctor",
  what: clip(what, WHAT_BUDGET),
  why: clip(why, WHY_BUDGET),
  fix: clip(fix, FIX_BUDGET),
  exit,
});

const say = (out: Output, text: string) => out.line(clip(text, COLUMNS));

function checkNode(ports: DoctorPorts, out: Output): Finding[] {
  const version = ports.machine.nodeVersion();
  if (nodeSatisfies(version)) {
    say(out, `mktrue: doctor · node · ✓ ${printable(version)}`);
    return [];
  }
  return [
    doctorFinding(
      `node ${printable(version)} is not node 24 or newer`,
      "the kit and the templates it renders are built for Node 24 LTS",
      "install Node 24 or newer",
      EXIT.ENVIRONMENT,
    ),
  ];
}

async function checkGit(ports: DoctorPorts, out: Output): Promise<Finding[]> {
  const findings = await checkEnvironment({ runner: ports.runner }, true);
  const missing = findings.find((f) => f.what === "git is not installed");
  if (missing === undefined) {
    const version = await ports.runner.probe(["git", "--version"]);
    say(out, `mktrue: doctor · git · ✓ ${printable(version ?? "")}`);
  }

  const identity = findings.filter((f) => f !== missing);
  if (missing === undefined && identity.length === 0) {
    const name = await ports.runner.probe(["git", "config", "user.name"]);
    const email = await ports.runner.probe(["git", "config", "user.email"]);
    say(out, `mktrue: doctor · git identity · ✓ ${printable(name ?? "")} · email set`);
  }

  return findings;
}

async function checkPnpm(ports: DoctorPorts, out: Output, pin: string): Promise<Finding[]> {
  const version = await ports.pnpmRunner.probe(["pnpm", "--version"]);
  if (version === undefined || !pnpmSatisfies(REQUIRED_PNPM, version)) {
    return [
      doctorFinding(
        `pnpm ${printable(pin)} is not installed`,
        "the offered templates ship a lockfile written for that pin",
        `corepack install -g pnpm@${printable(pin)}, or install pnpm 11 or newer`,
        EXIT.ENVIRONMENT,
      ),
    ];
  }
  const major = REQUIRED_PNPM.major;
  say(
    out,
    `mktrue: doctor · pnpm · ✓ ${printable(version)} · major ${major} matches the templates' pin ${printable(pin)}`,
  );
  return [];
}

function tilde(path: string, home: string): string {
  return home !== "" && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

async function checkOnPath(ports: DoctorPorts, out: Output): Promise<Finding[]> {
  const found = await ports.machine.whichMktrue();
  const self = await ports.machine.selfPath();
  if (found === undefined) {
    return [
      doctorFinding(
        "mktrue is not on PATH",
        "a terminal and the skill both run the mktrue command by name",
        `ln -s ${printable(tilde(self, ports.machine.homeDir()))} ~/.local/bin/mktrue`,
        EXIT.ENVIRONMENT,
      ),
    ];
  }
  if (found !== self) {
    return [
      doctorFinding(
        `PATH resolves mktrue to ${printable(found)}, not this bundle`,
        "a second mktrue on PATH would run instead of this one",
        `remove ${printable(found)}, or put ${printable(dirname(self))} ahead of it on PATH`,
        EXIT.ENVIRONMENT,
      ),
    ];
  }
  say(out, `mktrue: doctor · mktrue · ✓ ${printable(found)}`);
  return [];
}

async function checkSkill(ports: DoctorPorts, out: Output, write: boolean): Promise<Finding[]> {
  const home = await ports.machine.skillHome();
  if (home === undefined) {
    say(out, "mktrue: doctor · skill · none beside this mktrue · npm i -g mktrue carries it");
    if (!write) return [];
    return [
      doctorFinding(
        "doctor --write has no skill to link beside this mktrue",
        "the link points into the npm package or a kit checkout, and neither is here",
        "npm i -g mktrue, then run mktrue doctor --write",
        EXIT.ENVIRONMENT,
      ),
    ];
  }

  const target = join(home, "skill", "mktrue");
  const skillsDir = join(ports.machine.configDir(), "skills");
  const linkPath = join(skillsDir, "mktrue");
  const state = await ports.machine.inspectLink(linkPath);

  const displayPath = join(await ports.machine.realDir(skillsDir), "mktrue");

  if (state.kind === "link" && state.realPath === target) {
    say(out, `mktrue: doctor · skill · ✓ ${printable(displayPath)}`);
    return [];
  }

  if (!write) {
    return [
      doctorFinding(
        "the skill is not linked",
        "the skill turns one sentence into mktrue new; unlinked, it is not found",
        "run mktrue doctor --write",
        EXIT.ENVIRONMENT,
      ),
    ];
  }

  const ours =
    state.kind === "link" && (await ports.machine.readSkillName(state.realPath)) === "mktrue";
  const outcome =
    state.kind === "missing"
      ? await ports.machine.linkFresh(target, linkPath)
      : ours
        ? await ports.machine.relinkOurs(target, linkPath, state.realPath)
        : "in-the-way";

  if (outcome === "linked") {
    say(out, `mktrue: doctor · skill · linked · ${printable(displayPath)}`);
    return [];
  }

  return [
    doctorFinding(
      `is in the way: ${printable(displayPath)}`,
      "doctor --write replaces only its own link, not a directory, file or link",
      `move ${printable(displayPath)} aside, then run doctor --write again`,
      EXIT.DECISION,
    ),
  ];
}

async function checkOptional(
  ports: DoctorPorts,
  out: Output,
  tool: string,
  why: string,
): Promise<void> {
  const version = await ports.runner.probe([tool, "--version"]);
  say(
    out,
    version === undefined
      ? `mktrue: doctor · ${tool} · not found · ${why}`
      : `mktrue: doctor · ${tool} · ✓ ${printable(version.split(/\r?\n/u)[0] ?? "")}`,
  );
}

async function checkModel(ports: DoctorPorts, out: Output): Promise<Finding[]> {
  const model = await ports.machine.readSettingsModel();
  if (model === undefined) {
    say(out, "mktrue: doctor · model · not set");
    return [];
  }
  if (isOneMillionModel(model)) {
    return [
      doctorFinding(
        "the default model is a 1M-context variant",
        "long 1M-context sessions were measured as drift on the proving project",
        "set a default without [1m], and pick the 1M model per task",
        EXIT.FINDINGS,
      ),
    ];
  }
  say(out, `mktrue: doctor · model · ✓ ${printable(model)}`);
  return [];
}

export async function runDoctor(
  ports: DoctorPorts,
  out: Output,
  options: DoctorOptions,
): Promise<ExitCode> {
  const findings: Finding[] = [];
  const collect = (found: readonly Finding[]) => {
    for (const finding of found) out.finding(finding);
    findings.push(...found);
  };

  collect(checkNode(ports, out));
  collect(await checkGit(ports, out));
  collect(await checkPnpm(ports, out, templatesPnpmPin()));
  collect(await checkOnPath(ports, out));
  collect(await checkSkill(ports, out, options.write));

  await checkOptional(ports, out, "docker", "the infrastructure template (6d)");
  await checkOptional(ports, out, "gh", "setting MKTRUE_TOKEN on a product");
  await checkOptional(ports, out, "claude", "the skill");

  collect(await checkModel(ports, out));

  const exit = exitCodeFor(findings);
  if (exit === EXIT.TRUE) {
    out.verdict("mktrue: this machine is ready");
    return EXIT.TRUE;
  }
  say(out, `mktrue: ${findings.length} finding${findings.length === 1 ? "" : "s"} · exit ${exit}`);
  return exit;
}
