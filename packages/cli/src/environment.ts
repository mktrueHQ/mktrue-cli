import { EXIT, type Finding } from "@mktrue/core";

import type { Runner } from "./ports.js";

export interface EnvironmentPorts {
  readonly runner: Runner;
}

export const environment = (what: string, why: string, fix: string): Finding => ({
  gate: "environment",
  what,
  why,
  fix,
  exit: EXIT.ENVIRONMENT,
});

/**
 * git, its identity, and whatever the plan's `requires` lists (unless
 * `offline`), checked the way `new` checks them before it writes anything.
 * `doctor` calls this too, always with `offline: true`; it checks pnpm
 * itself, pinned to the templates.
 */
export async function checkEnvironment(
  ports: EnvironmentPorts,
  offline: boolean,
  requires: readonly string[] = ["pnpm"],
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const { runner } = ports;

  if ((await runner.probe(["git", "--version"])) === undefined) {
    findings.push(
      environment(
        "git is not installed",
        "new commits the repository it makes, and records who made it",
        "install git, then run the command again",
      ),
    );
  } else {
    for (const key of ["user.name", "user.email"]) {
      const value = await runner.probe(["git", "config", key]);
      if (value === undefined || value === "") {
        findings.push(
          environment(
            `git has no ${key}`,
            "the first commit is made under your own identity, never an invented one",
            `git config --global ${key} "<yours>"`,
          ),
        );
      }
    }
  }

  if (
    !offline &&
    requires.includes("pnpm") &&
    (await runner.probe(["pnpm", "--version"])) === undefined
  ) {
    findings.push(
      environment(
        "pnpm is not installed",
        "new installs the workspace and runs its gates before the first commit",
        "install pnpm, or pass --offline to render without verifying",
      ),
    );
  }

  if (
    !offline &&
    requires.includes("docker") &&
    (await runner.probe(["docker", "--version"])) === undefined
  ) {
    findings.push(
      environment(
        "docker is not installed",
        "the infrastructure template's gates run in containers",
        "install Docker, or pass --offline to render without verifying",
      ),
    );
  }
  return findings;
}
