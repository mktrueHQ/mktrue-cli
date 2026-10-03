#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// The npm package, proved as a user gets it (decision 0034, slice 8b-2):
// `npm pack --dry-run` lists exactly the expected files; unless --list-only,
// the packed tarball installs into a temporary prefix and runs --help, check
// on a fixture, and doctor --write, while a broken bench planted three
// directories above the installed bundle is never read. Nothing is published.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const { values } = parseArgs({
  options: {
    package: { type: "string", default: join(ROOT, "packages", "cli") },
    work: { type: "string" },
    "list-only": { type: "boolean", default: false },
  },
});

const packageDir = resolve(values.package);
const ownWork = values.work === undefined;
const work = ownWork ? mkdtempSync(join(tmpdir(), "mktrue-pack-proof-")) : resolve(values.work);
mkdirSync(work, { recursive: true });

const say = (line) => process.stdout.write(`pack-proof: ${line}\n`);
const fail = (line, detail = "") => {
  process.stderr.write(`pack-proof: ✗ ${line}\n${detail}`);
  if (ownWork) rmSync(work, { recursive: true, force: true });
  process.exit(1);
};

writeFileSync(join(work, "npmrc"), "");
const npmEnv = {
  ...process.env,
  npm_config_userconfig: join(work, "npmrc"),
  npm_config_cache: join(work, "npm-cache"),
  npm_config_update_notifier: "false",
  npm_config_audit: "false",
  npm_config_fund: "false",
};

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", env: npmEnv, ...options });
  if (result.error !== undefined) fail(`${command} did not start: ${result.error.code}`);
  return result;
};

const filesUnder = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"));

const expected = [
  "LICENSE",
  "README.md",
  "THIRD_PARTY_NOTICES",
  "dist/mktrue.js",
  "package.json",
  ...filesUnder(join(ROOT, "skill")).map((path) => `skill/${path}`),
].sort();

const dry = run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: packageDir });
if (dry.status !== 0) fail("npm pack --dry-run failed", dry.stderr);
const listed = JSON.parse(dry.stdout)[0]
  .files.map((file) => file.path)
  .sort();
const extra = listed.filter((path) => !expected.includes(path));
const missing = expected.filter((path) => !listed.includes(path));
if (extra.length > 0 || missing.length > 0) {
  fail(
    "the pack lists other files than expected",
    `  extra   ${extra.join(", ") || "none"}\n  missing ${missing.join(", ") || "none"}\n`,
  );
}
say(`✓ npm pack lists exactly ${listed.length} files`);

if (!values["list-only"]) {
  const packed = run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", work], {
    cwd: packageDir,
  });
  if (packed.status !== 0) fail("npm pack failed", packed.stderr);
  const tarball = join(work, JSON.parse(packed.stdout)[0].filename);

  const prefix = join(work, "prefix");
  const installed = run("npm", [
    "install",
    "--global",
    "--prefix",
    prefix,
    "--ignore-scripts",
    "--offline",
    tarball,
  ]);
  if (installed.status !== 0) fail("npm install of the tarball failed", installed.stderr);

  const packageRoot = realpathSync(join(prefix, "lib", "node_modules", "mktrue"));
  const threeUp = resolve(packageRoot, "dist", "..", "..", "..");
  mkdirSync(join(threeUp, "bench"), { recursive: true });
  writeFileSync(join(threeUp, "bench", "bench.json"), "{ a stray bench, never to be read");
  const bin = join(prefix, "bin", "mktrue");

  const help = run(bin, ["--help"], { cwd: work });
  if (help.status !== 0 || !help.stdout.includes("doctor [--write]")) {
    fail("the installed mktrue --help failed", help.stdout + help.stderr);
  }
  say("✓ the installed mktrue runs --help");

  const repo = join(work, "repo");
  for (const dir of ["docs/decisions", "docs/design", "docs/log", ".claude"]) {
    mkdirSync(join(repo, dir), { recursive: true });
  }
  writeFileSync(join(repo, ".mktrue.json"), readFileSync(join(ROOT, ".mktrue.json")));
  writeFileSync(
    join(repo, ".claude", "settings.json"),
    readFileSync(join(ROOT, "bench", "settings", "claude-code.json")),
  );
  for (const [path, text] of [
    ["docs/STATE.md", "# State\n"],
    ["docs/ROADMAP.md", "# Roadmap\n"],
    ["CLAUDE.md", "# Rules\n"],
    ["docs/decisions/index.md", "# Index\n"],
    ["docs/design/m1.md", "# Design\n"],
    ["docs/log/a.md", "# Log\n"],
  ]) {
    writeFileSync(join(repo, path), text);
  }
  const check = run(bin, ["check"], { cwd: repo });
  if (check.status !== 0) fail("the installed mktrue check failed", check.stdout + check.stderr);
  say(`✓ check on a fixture, the stray ${relative(work, threeUp)}/bench ignored`);

  const config = join(work, "config");
  const home = join(work, "home");
  mkdirSync(home, { recursive: true });
  const doctor = run(bin, ["doctor", "--write"], {
    cwd: work,
    env: { ...npmEnv, CLAUDE_CONFIG_DIR: config, HOME: home },
  });
  const target = join(packageRoot, "skill", "mktrue");
  let linked;
  try {
    linked = readlinkSync(join(config, "skills", "mktrue"));
  } catch {
    fail("doctor --write made no skill link", doctor.stdout + doctor.stderr);
  }
  if (linked !== target) fail(`doctor --write linked ${linked}, not ${target}`, doctor.stdout);
  const skill = readFileSync(join(target, "SKILL.md"), "utf8");
  if (skill !== readFileSync(join(ROOT, "skill", "mktrue", "SKILL.md"), "utf8")) {
    fail("the packed SKILL.md differs from skill/mktrue/SKILL.md");
  }
  say("✓ doctor --write links the skill inside the package");
}

if (ownWork) rmSync(work, { recursive: true, force: true });
