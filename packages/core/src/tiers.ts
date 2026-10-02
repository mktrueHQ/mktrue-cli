import type { BenchManifest } from "@mktrue/contracts";

import { EXIT, type Finding } from "./findings.js";

export function checkTiers(manifest: BenchManifest): { findings: Finding[]; tiered: number } {
  const findings: Finding[] = [];

  for (const [targetName, target] of Object.entries(manifest.targets)) {
    const models = new Set(target.vocabulary.models);
    const efforts = new Set(target.vocabulary.efforts);
    const silentlyIgnores = new Set(target.vocabulary.effortUnsupportedOn);

    for (const role of manifest.roles) {
      // A full model id, the only form with hyphens, is never in a vocabulary.
      if (role.model !== undefined && !models.has(role.model) && !role.model.includes("-")) {
        findings.push({
          gate: "tiers",
          what: `role ${role.id} has model "${role.model}", which ${targetName} does not accept`,
          why: "an unrecognised model silently falls back to the session default, so the tier is not applied",
          fix: `use one of ${[...models].join(", ")} or a full model id`,
          exit: EXIT.FINDINGS,
        });
      }

      if (typeof role.effort === "string" && !efforts.has(role.effort)) {
        findings.push({
          gate: "tiers",
          what: `role ${role.id} has effort "${role.effort}", which ${targetName} does not accept`,
          why: "an unrecognised effort is ignored without an error, so the role runs at the default depth",
          fix: `use one of ${[...efforts].join(", ")} or an integer token budget`,
          exit: EXIT.FINDINGS,
        });
      }

      if (
        role.effort !== undefined &&
        role.model !== undefined &&
        silentlyIgnores.has(role.model)
      ) {
        findings.push({
          gate: "tiers",
          what: `role ${role.id} sets an effort on ${role.model}, which ignores it`,
          why: "the setting is accepted and then discarded, so the role runs at the default depth while the manifest claims otherwise",
          fix: `move ${role.id} to a model that supports effort, or drop the effort (decision 0005)`,
          exit: EXIT.FINDINGS,
        });
      }
    }
  }

  for (const role of manifest.roles) {
    if (role.tools.length === 0) {
      findings.push({
        gate: "tiers",
        what: `role ${role.id} declares no tools`,
        why: "a role rendered without a tools list inherits every tool, which silently widens a read-only role",
        fix: `list the tools ${role.id} needs in bench/bench.json`,
        exit: EXIT.FINDINGS,
      });
    }
  }

  const tiered = manifest.roles.filter(
    (r) => r.model !== undefined && r.effort !== undefined,
  ).length;
  return { findings, tiered };
}
