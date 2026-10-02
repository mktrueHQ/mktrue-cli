#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { inject } from "postject";

// decision 0033: the single executable for this machine's OS and architecture,
// built from the node running this script and the CommonJS bundle. With
// --archive, also the release asset: mktrue-<os>-<arch>.tar.xz holding one file,
// mktrue, and its SHA256SUMS line beside it (decision 0035).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages", "cli");
const FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const OS = { linux: "linux", darwin: "darwin" };

const { values } = parseArgs({
  options: {
    out: { type: "string", default: join(CLI, "dist") },
    archive: { type: "string" },
  },
});

const say = (line) => process.stdout.write(`build-sea: ${line}\n`);
const fail = (what, why, fix) => {
  process.stderr.write(`build-sea: ✗ ${what}\n  why   ${why}\n  fix   ${fix}\n`);
  process.exit(1);
};

const run = (command, args, cwd = CLI, env = {}) => {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  if (result.error !== undefined || result.status !== 0) {
    fail(
      `${command} ${args.join(" ")} failed`,
      (result.stderr || result.error?.message || "").trim() || `exit ${result.status}`,
      "fix the step above, then run build-sea again",
    );
  }
};

const os = OS[process.platform];
if (os === undefined) {
  fail(
    `no single executable for ${process.platform}`,
    "binaries are built for Linux and macOS only",
    "install mktrue with npm i -g mktrue",
  );
}

const config = JSON.parse(readFileSync(join(CLI, "sea-config.json"), "utf8"));
if (!existsSync(join(CLI, config.main))) {
  fail(
    `${config.main} is missing`,
    "the binary embeds the CommonJS bundle",
    "run pnpm build first",
  );
}

run(process.execPath, ["--experimental-sea-config", "sea-config.json"]);
const blob = readFileSync(join(CLI, config.output));

const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const binary = join(out, `mktrue-${os}-${process.arch}`);
copyFileSync(process.execPath, binary);
chmodSync(binary, 0o755);

if (os === "darwin") run("codesign", ["--remove-signature", binary]);
await inject(binary, "NODE_SEA_BLOB", blob, {
  sentinelFuse: FUSE,
  ...(os === "darwin" ? { machoSegmentName: "NODE_SEA" } : {}),
});
if (os === "darwin") run("codesign", ["--sign", "-", binary]);

say(`${binary} · ${statSync(binary).size} bytes`);

if (values.archive !== undefined) {
  const release = resolve(values.archive);
  mkdirSync(release, { recursive: true });
  const archive = join(release, `${basename(binary)}.tar.xz`);
  const stage = mkdtempSync(join(tmpdir(), "mktrue-archive-"));
  copyFileSync(binary, join(stage, "mktrue"));
  chmodSync(join(stage, "mktrue"), 0o755);
  const level = os === "darwin" ? ["--options", "xz:compression-level=9"] : [];
  run("tar", [...level, "-cJf", archive, "-C", stage, "mktrue"], stage, {
    XZ_OPT: "-9",
    COPYFILE_DISABLE: "1",
  });
  rmSync(stage, { recursive: true, force: true });
  const sum = createHash("sha256").update(readFileSync(archive)).digest("hex");
  writeFileSync(`${archive}.sha256`, `${sum}  ${basename(archive)}\n`);
  say(`${archive} · ${statSync(archive).size} bytes · sha256 ${sum}`);
}
