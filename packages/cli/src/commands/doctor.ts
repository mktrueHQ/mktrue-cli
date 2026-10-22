import { dirname, join } from "node:path";

import {
  EXIT,
  REQUIRED_PNPM,
  characterCount,
  exitCodeFor,
  isOneMillionModel,
  missingRoleFiles,
  nodeSatisfies,
  pnpmSatisfies,
  sessionReport,
  type ExitCode,
  type Finding,
  type LoadedName,
  type SessionAllowance,
  type SessionFile,
  type SessionScope,
} from "@mktrue/core";
import { templateManifestSchema } from "@mktrue/contracts";

import { checkEnvironment } from "../environment.js";
import { templatesPnpmPin } from "../pnpm-pin.js";
import type { DoctorPorts, Output } from "../ports.js";
import { clip, columns, printable } from "../report.js";
import { embeddedManifest } from "../repo.js";
import { EMBEDDED_TEMPLATES } from "../templates.embedded.js";
import {
  REPOSITORY_READ_MAX_BYTES,
  extractEnabledPlugins,
  extractMcpServerNames,
  namesIn,
} from "../adapters.js";

const ROLE_TARGET = "claude-code";
const ROLE_SLOT = "__MKTRUE_ROLE_ID__";

export interface DoctorOptions {
  readonly write: boolean;
}

const doctorFinding = (what: string, why: string, fix: string, exit: ExitCode): Finding => ({
  gate: "doctor",
  what: clip(what, columns() - "mktrue: ✗ doctor · ".length),
  why: clip(why, columns() - "  why   ".length),
  fix: clip(fix, columns() - "  fix   ".length),
  exit,
});

const say = (out: Output, text: string) => out.line(clip(text, columns()));

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

  if (!write && state.kind === "link") {
    const elsewhere = printable(tilde(state.realPath, ports.machine.homeDir()));
    const ours = (await ports.machine.readSkillName(state.realPath)) === "mktrue";
    return [
      doctorFinding(
        `the skill link points at ${elsewhere}`,
        ours
          ? "that is another install's skill, not the one this mktrue carries"
          : "that is not a mktrue skill; doctor --write replaces only its own link",
        ours
          ? "run mktrue doctor --write"
          : "remove that link by hand, then run mktrue doctor --write",
        EXIT.ENVIRONMENT,
      ),
    ];
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

async function readInside(
  read: (path: string) => Promise<string | undefined>,
  path: string,
): Promise<string | undefined> {
  try {
    return await read(path);
  } catch {
    return undefined;
  }
}

interface Inside {
  readonly top: string;
  read(path: string): Promise<string | undefined>;
  list(dir: string): Promise<string[]>;
}

async function openInside(ports: DoctorPorts): Promise<Inside | undefined> {
  const top = await ports.runner.probe(["git", "rev-parse", "--show-toplevel"]);
  const repository = top === undefined ? undefined : ports.repository?.(top);
  if (top === undefined || repository === undefined) return undefined;
  return {
    top,
    read: (path) => readInside((p) => repository.read(p, REPOSITORY_READ_MAX_BYTES), path),
    async list(dir) {
      try {
        return await repository.list(dir);
      } catch {
        return [];
      }
    },
  };
}

const AGENTS_DIR = ".claude/agents";

function templateNameOf(configText: string | undefined): string | undefined {
  if (configText === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(configText);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object") return undefined;
  const template = (parsed as Record<string, unknown>)["template"];
  if (template === null || typeof template !== "object") return undefined;
  const name = (template as Record<string, unknown>)["name"];
  return typeof name === "string" ? name : undefined;
}

function allowanceFor(template: string | undefined): SessionAllowance | undefined {
  if (template === undefined) return undefined;
  const text = EMBEDDED_TEMPLATES[`${template}/template.json`];
  if (text === undefined) return undefined;
  const manifest = templateManifestSchema.safeParse(JSON.parse(text));
  if (!manifest.success) return undefined;
  return { template: manifest.data.name, allowlist: manifest.data.session };
}

async function checkSession(
  ports: DoctorPorts,
  out: Output,
  inside: Inside | undefined,
): Promise<Finding[]> {
  const home = ports.machine.homeDir();
  const user = ports.machine.userConfigFiles();
  const plugins: LoadedName[] = [];
  const mcpServers: LoadedName[] = [];
  const named = (
    into: LoadedName[],
    names: readonly string[],
    scope: SessionScope,
    source: string,
  ): void => {
    for (const name of names)
      into.push({ name: printable(name), scope, source: printable(source) });
  };

  const files: SessionFile[] = [];
  named(plugins, await ports.machine.readUserPluginNames(), "user", tilde(user.settings, home));
  const servers = await ports.machine.readUserMcpServerNames(inside?.top);
  named(mcpServers, servers.user, "user", tilde(user.config, home));
  named(mcpServers, servers.local, "local", tilde(user.config, home));
  let allowance: SessionAllowance | undefined;

  if (inside !== undefined) {
    const sized = async (path: string) => {
      const text = await inside.read(path);
      if (text === undefined) return;
      files.push({ path: printable(path), characters: characterCount(text) });
    };
    await sized("CLAUDE.md");
    const agents = (await inside.list(AGENTS_DIR)).filter(
      (path) => path.endsWith(".md") && !path.slice(AGENTS_DIR.length + 1).includes("/"),
    );
    for (const path of agents) await sized(path);

    for (const [path, scope] of [
      [".claude/settings.json", "project"],
      [".claude/settings.local.json", "local"],
    ] as const) {
      named(plugins, namesIn(await inside.read(path), extractEnabledPlugins), scope, path);
    }
    named(
      mcpServers,
      namesIn(await inside.read(".mcp.json"), extractMcpServerNames),
      "project",
      ".mcp.json",
    );
    allowance = allowanceFor(templateNameOf(await inside.read(".mktrue.json")));
  }

  const { lines, findings } = sessionReport({ files, plugins, mcpServers }, allowance);
  for (const line of lines) say(out, line);
  return findings.map((f) => doctorFinding(f.what, f.why, f.fix, f.exit));
}

async function checkRoles(
  ports: DoctorPorts,
  out: Output,
  inside: Inside | undefined,
): Promise<Finding[]> {
  if (inside === undefined) return [];
  const read = inside.read;
  if ((await read(".mktrue.json")) === undefined) {
    say(out, "mktrue: doctor · roles · not checked · this repository has no .mktrue.json");
    return [];
  }
  const manifest = embeddedManifest();
  const pattern = manifest.targets[ROLE_TARGET]!.roles;
  const pathOf = (role: string) => pattern.replace(ROLE_SLOT, role);
  const roles = manifest.roles.map((role) => role.id);
  const files = new Map<string, string | undefined>();
  for (const role of roles) files.set(role, await read(pathOf(role)));
  const missing = missingRoleFiles(roles, files);
  if (missing.length === 0) {
    say(out, `mktrue: doctor · roles · ✓ ${roles.length} bench roles · ${dirname(pathOf(""))}`);
    return [];
  }
  return missing.map((role) =>
    doctorFinding(
      `role ${printable(role)} has no agent file naming it`,
      "every run is spawned with its bench role as the agent type",
      `mktrue sync --write renders ${printable(pathOf(role))}`,
      EXIT.FINDINGS,
    ),
  );
}

export async function runDoctor(
  ports: DoctorPorts,
  out: Output,
  options: DoctorOptions,
): Promise<ExitCode> {
  const findings: Finding[] = [];
  const collect = (found: readonly Finding[]) => {
    for (const finding of found) {
      out.finding(finding);
      findings.push(finding);
    }
  };

  collect(checkNode(ports, out));
  collect(await checkGit(ports, out));
  collect(await checkPnpm(ports, out, templatesPnpmPin()));
  collect(await checkOnPath(ports, out));
  collect(await checkSkill(ports, out, options.write));

  await checkOptional(ports, out, "docker", "the infrastructure template");
  await checkOptional(ports, out, "claude", "the skill");

  collect(await checkModel(ports, out));
  const inside = await openInside(ports);
  collect(await checkRoles(ports, out, inside));
  collect(await checkSession(ports, out, inside));

  const exit = exitCodeFor(findings);
  if (exit === EXIT.TRUE) {
    out.verdict("mktrue: this machine is ready");
    return EXIT.TRUE;
  }
  say(out, `mktrue: ${findings.length} finding${findings.length === 1 ? "" : "s"} · exit ${exit}`);
  return exit;
}
