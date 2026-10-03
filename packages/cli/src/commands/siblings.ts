import { mktrueConfigSchema, type MktrueConfig, type SiblingsReport } from "@mktrue/contracts";
import {
  EXIT,
  compareSiblings,
  describeRepository,
  exitCodeFor,
  pathsToRead,
  planCounts,
  shownSibling,
  type BenchSource,
  type ExitCode,
  type RepositoryState,
  type SiblingInput,
} from "@mktrue/core";

import { BlobTooLarge, GitRefused, MAX_BLOB_BYTES } from "../git.js";
import type { FileSystem, LocatedSibling, Output, SiblingPorts } from "../ports.js";
import type { Repo } from "../repo.js";
import { columns, clip, errorCode, printable, refuse } from "../report.js";
import { printGates, printVerdict, runGates } from "./check.js";

export interface SiblingsOptions {
  readonly kitVersion: string;
  readonly target: string;
  readonly json: boolean;
}

interface Describe {
  (
    config: MktrueConfig,
    read: (path: string) => Promise<string | undefined>,
  ): Promise<RepositoryState | undefined>;
}

function describer(bench: BenchSource, options: SiblingsOptions): Describe {
  return async (config, read) => {
    const input = { config, bench, kitVersion: options.kitVersion, target: options.target };
    const current = new Map<string, string>();
    for (const path of pathsToRead(input)) {
      const content = await read(path);
      if (content !== undefined) current.set(path, content);
    }
    const described = describeRepository({ ...input, current });
    return "state" in described ? described.state : undefined;
  };
}

async function readSibling(
  entry: number,
  located: LocatedSibling,
  describe: Describe,
): Promise<SiblingInput> {
  if (located.kind === "unreadable") {
    return {
      entry,
      path: located.shown,
      readable: false,
      why: located.why,
      ...(located.refused === true ? { refused: true as const } : {}),
    };
  }
  const unreadable = (why: string): SiblingInput => ({
    entry,
    path: located.shown,
    readable: false,
    why,
  });

  const branch = await located.baseBranch();
  if (branch === undefined) return unreadable("its .mktrue.json names no baseBranch");

  try {
    let found: { ref: string; commit: string; short: string } | undefined;
    for (const [ref, full] of [
      [`origin/${branch}`, `refs/remotes/origin/${branch}`],
      [branch, `refs/heads/${branch}`],
    ] as const) {
      const resolved = await located.git.resolve(full);
      if (resolved !== undefined) {
        found = { ref, ...resolved };
        break;
      }
    }
    if (found === undefined) return unreadable(`no origin/${branch} or ${branch}`);

    const { commit } = found;
    const text = await located.git.read(commit, ".mktrue.json");
    if (text === undefined) return unreadable(`it has no .mktrue.json at ${found.ref}`);
    let config: MktrueConfig;
    try {
      const parsed = mktrueConfigSchema.safeParse(JSON.parse(text));
      if (!parsed.success) return unreadable(`its .mktrue.json at ${found.ref} is not valid`);
      config = parsed.data;
    } catch {
      return unreadable(`its .mktrue.json at ${found.ref} is not JSON`);
    }

    const state = await describe(config, (path) => located.git.read(commit, path));
    if (state === undefined) return unreadable("its answers do not render with this kit");

    return {
      entry,
      path: located.shown,
      readable: true,
      ref: found.ref,
      commit: found.short,
      listsBack: await located.listsBack(config.answers.siblings),
      state,
    };
  } catch (error) {
    if (error instanceof GitRefused)
      return unreadable("it names a ref or path mktrue will not read");
    if (error instanceof BlobTooLarge) {
      return unreadable(`${error.path} is over ${MAX_BLOB_BYTES / 1024 / 1024} MiB`);
    }
    throw error;
  }
}

async function locateAndRead(
  entry: number,
  listed: string,
  ports: SiblingPorts,
  describe: Describe,
): Promise<SiblingInput> {
  const failed = (path: string | null, error: unknown): SiblingInput => ({
    entry,
    path,
    readable: false,
    why: `an unexpected error: ${errorCode(error)}`,
  });
  let located: LocatedSibling;
  try {
    located = await ports.locate(listed);
  } catch (error) {
    return failed(null, error);
  }
  try {
    return await readSibling(entry, located, describe);
  } catch (error) {
    return failed(located.shown, error);
  }
}

const stateLine = (label: string, where: string, kit: string): string =>
  clip(`mktrue: ${label} · ${printable(where)} · kit ${printable(kit)}`, columns());

const countsLine = (label: string, state: RepositoryState): string =>
  clip(
    `mktrue: ${label} · ${Object.keys(state.owned).length} owned · ${state.edited} edited · ${state.pins.length} pinned · ${state.plan.length} behind`,
    columns(),
  );

export async function runCheckSiblings(
  repo: Repo,
  fs: FileSystem,
  out: Output,
  ports: SiblingPorts,
  options: SiblingsOptions,
): Promise<ExitCode> {
  if (repo.config === undefined || repo.manifest === undefined) {
    if (repo.findings.length > 0) {
      for (const finding of repo.findings) out.finding(finding);
      return exitCodeFor(repo.findings);
    }
    return refuse(
      out,
      "siblings",
      "this directory has no .mktrue.json, or no bench to compare with",
      "its answers.siblings names the siblings, and the bench is what they are compared to",
      "run check --siblings from a repository mktrue made",
      EXIT.USAGE,
    );
  }
  const config = repo.config;
  const describe = describer({ manifest: repo.manifest, bodies: repo.bodies }, options);

  const gates = runGates(repo, options.kitVersion);
  const self = await describe(config, (path) => fs.read(path));
  if (self === undefined) {
    return refuse(
      out,
      "siblings",
      "this repository's answers do not render with this kit",
      "its plan is what every sibling is compared to",
      "run `mktrue sync` here and fix what it names",
      EXIT.USAGE,
    );
  }

  const siblings: SiblingInput[] = [];
  for (const [entry, listed] of config.answers.siblings.entries()) {
    siblings.push(await locateAndRead(entry, listed, ports, describe));
  }
  const comparison = compareSiblings(self, siblings);
  const divergences = comparison.findings.filter((finding) => finding.exit !== EXIT.TRUE);
  const counted = [...gates.findings, ...divergences];
  const exit = exitCodeFor(counted);

  if (options.json) {
    const report: SiblingsReport = {
      schema: 1,
      kit: options.kitVersion,
      self: {
        path: ".",
        ref: "working tree",
        kit: self.kit,
        owned: Object.keys(self.owned).length,
        edited: self.edited,
        pinned: self.pins.length,
        plan: planCounts(self.plan),
      },
      siblings: [...comparison.rows],
      findings: comparison.findings.map(({ code, entry, path, what, why, fix, exit }) => ({
        code,
        entry,
        path,
        what,
        why,
        fix,
        exit,
      })),
      gates: { findings: gates.findings.length, exit: exitCodeFor(gates.findings) },
      exit,
    };
    out.line(JSON.stringify(report));
    return exit;
  }

  printGates(gates, out);
  const read = siblings.filter((sibling) => sibling.readable).length;
  out.line(
    `mktrue: siblings · ${siblings.length} listed · ${read} read · ${comparison.diverging} diverge${comparison.diverging === 1 ? "s" : ""}`,
  );
  out.line(stateLine("self", "working tree", self.kit));
  out.line(countsLine("self", self));
  for (const sibling of siblings) {
    const label = `sibling ${printable(shownSibling(sibling.entry, sibling.path))}`;
    if (!sibling.readable) {
      out.line(clip(`mktrue: ${label} · unreadable · ${printable(sibling.why)}`, columns()));
      continue;
    }
    out.line(stateLine(label, `${sibling.ref} ${sibling.commit}`, sibling.state.kit));
    out.line(countsLine(label, sibling.state));
  }
  for (const finding of comparison.findings) {
    const head = finding.exit === EXIT.TRUE ? "mktrue: note · " : `mktrue: ✗ ${finding.gate} · `;
    out.line(`${head}${clip(printable(finding.what), columns() - head.length)}`);
    out.line(`  why   ${printable(finding.why)}`);
    out.line(`  fix   ${clip(printable(finding.fix), columns() - "  fix   ".length)}`);
  }
  return printVerdict(counted.length, exit, out);
}
