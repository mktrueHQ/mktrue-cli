import {
  EXIT,
  configAfterBench,
  exitCodeFor,
  planBench,
  renderBenchFor,
  type ExitCode,
} from "@mktrue/core";

import type { FileSystem, Output } from "../ports.js";
import type { Repo } from "../repo.js";
import { COLUMNS, clip, errorCode, refuse, row } from "../report.js";

export interface SyncOptions {
  readonly write: boolean;
  readonly adopt: boolean;
  readonly restore: boolean;
  readonly kitVersion: string;
  readonly target: string;
}

export async function runSync(
  repo: Repo,
  fs: FileSystem,
  out: Output,
  options: SyncOptions,
): Promise<ExitCode> {
  if (repo.findings.length > 0) {
    for (const finding of repo.findings) out.finding(finding);
    return exitCodeFor(repo.findings);
  }

  if (repo.config === undefined) {
    return refuse(
      out,
      "sync",
      "this directory has no .mktrue.json",
      "sync needs the hashes from the last render to tell your edits from ours",
      "run sync from a repository mktrue made, or `mktrue sync --adopt`",
      EXIT.USAGE,
    );
  }
  if (repo.manifest === undefined) {
    return refuse(
      out,
      "sync",
      "no bench was found to render from",
      "without the kit's bench there is nothing to compare this repository to",
      "run sync from an installed mktrue, or from the kit repository itself",
      EXIT.USAGE,
    );
  }

  const config = repo.config;
  const rendered = renderBenchFor(
    { manifest: repo.manifest, bodies: repo.bodies, release: repo.release },
    config,
    options.kitVersion,
    options.target,
  );
  if (rendered.findings.length > 0) {
    for (const finding of rendered.findings) out.finding(finding);
    return exitCodeFor(rendered.findings);
  }

  const current = new Map<string, string>();
  const paths = [
    ...rendered.files.map((file) => file.path),
    ...Object.keys(config.owned),
    rendered.rules.path,
  ];
  for (const path of new Set(paths)) {
    const content = await fs.read(path);
    if (content !== undefined) current.set(path, content);
  }

  const bench = planBench(rendered, config, current, {
    adopt: options.adopt,
    restore: options.restore,
  });
  const plan = bench.files;
  const rulesPlan = bench.rules;

  out.line(
    clip(
      `mktrue: sync · kit ${config.kit} → ${options.kitVersion} · ${options.write ? "writing" : "dry run"}`,
      COLUMNS,
    ),
  );
  for (const entry of plan.entries) {
    if (entry.action === "unchanged") continue;
    out.line(row(entry.action, entry.path, entry.reason));
  }
  if (rulesPlan.action !== "unchanged") {
    out.line(row(rulesPlan.action, rulesPlan.path, rulesPlan.reason));
  }

  if (options.write) {
    const staged: { from: string; to: string }[] = [];
    const landed = new Set<string>();

    const stage = async (path: string, content: string): Promise<void> => {
      const tmp = `${path}.mktrue-staged`;
      await fs.write(tmp, content);
      staged.push({ from: tmp, to: path });
    };

    try {
      for (const entry of plan.entries) {
        if (entry.action === "update" && entry.next !== undefined) {
          await stage(entry.path, entry.next);
        }
        if (entry.action === "conflict" && entry.next !== undefined) {
          await stage(`${entry.path}.mktrue-next`, entry.next);
        }
      }
      if (rulesPlan.next !== undefined) await stage(rulesPlan.path, rulesPlan.next);
    } catch (error) {
      for (const item of staged) await fs.remove(item.from);
      return refuse(
        out,
        "sync",
        "staging failed, so nothing was written",
        "a write failed before anything moved, so this repository is untouched",
        clip(
          `${errorCode(error)} on a write: make this repository writable, then run sync again`,
          COLUMNS - "  fix   ".length,
        ),
        EXIT.FINDINGS,
      );
    }

    for (const item of staged) {
      await fs.rename(item.from, item.to);
      landed.add(item.to);
    }

    const updated = {
      ...(repo.rawConfig ?? {}),
      ...configAfterBench(config, bench, landed, options.kitVersion),
    };
    await fs.write(".mktrue.json", `${JSON.stringify(updated, null, 2)}\n`);
  }

  const { update, keep, conflict, skip, removed } = plan.counts;
  const summary = [
    `${update} update${update === 1 ? "" : "s"}`,
    `${keep} kept`,
    `${conflict} conflict${conflict === 1 ? "" : "s"}`,
    `${skip} skipped`,
    `${removed} removed`,
  ].join(" · ");

  const allFindings = [...plan.findings, ...rulesPlan.findings];
  for (const finding of allFindings) out.finding(finding);

  const exit = exitCodeFor(allFindings);
  if (!options.write && (update > 0 || conflict > 0)) {
    out.line(`mktrue: ${summary} · run with --write to apply`);
  } else {
    out.line(`mktrue: ${summary}`);
  }
  if (exit === EXIT.TRUE) out.verdict("mktrue: true · exit 0");
  return exit;
}
