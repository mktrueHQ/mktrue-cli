import type { BenchManifest, Role, Target } from "@mktrue/contracts";

import { EXIT, type Finding } from "./findings.js";
import { writeRegion } from "./regions.js";
import { substitute } from "./slots.js";

export interface RenderedFile {
  readonly path: string;
  readonly content: string;
}

export interface RenderedRegion {
  readonly id: string;
  readonly content: string;
}

export interface RenderedRules {
  readonly path: string;
  readonly managed: readonly RenderedRegion[];
  readonly skeleton: string;
}

function yamlScalar(value: string): string {
  if (/^[A-Za-z0-9_][A-Za-z0-9 _.\-/]*$/.test(value) && !value.includes(": ")) {
    return value;
  }
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(
      /[\u0000-\u001f\u007f]/g,
      (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
    );
  return `"${escaped}"`;
}

export function roleFrontmatter(role: Role, target: Target): string {
  const lines: string[] = [];
  for (const field of target.roleFrontmatter) {
    switch (field) {
      case "name":
        lines.push(`name: ${role.id}`);
        break;
      case "description":
        lines.push(`description: ${yamlScalar(role.description)}`);
        break;
      case "tools":
        lines.push(`tools: ${role.tools.join(", ")}`);
        break;
      case "model":
        if (role.model !== undefined) lines.push(`model: ${role.model}`);
        break;
      case "effort":
        if (role.effort !== undefined) lines.push(`effort: ${role.effort}`);
        break;
      default:
        break;
    }
  }
  return `---\n${lines.join("\n")}\n---\n`;
}

export function missingTargetFinding(
  manifest: BenchManifest,
  targetName: string,
): Finding | undefined {
  if (targetName in manifest.targets) return undefined;
  return {
    gate: "render",
    what: `the bench declares no target named ${targetName}`,
    why: "without a target nothing knows where a rendered file belongs",
    fix: `add ${targetName} to targets in bench/bench.json, or render for one that exists`,
    exit: EXIT.USAGE,
  };
}

export function renderBench(
  manifest: BenchManifest,
  bodies: ReadonlyMap<string, string>,
  values: ReadonlyMap<string, string>,
  targetName: string,
): { files: RenderedFile[]; rules: RenderedRules; findings: Finding[] } {
  const findings: Finding[] = [];
  const files: RenderedFile[] = [];
  const missing = missingTargetFinding(manifest, targetName);

  if (missing !== undefined) {
    return {
      files,
      rules: { path: "", managed: [], skeleton: "" },
      findings: [missing],
    };
  }
  const target = manifest.targets[targetName]!;

  const effective = new Map(values);
  for (const [key, slot] of Object.entries(manifest.slots)) {
    if (!slot.required && !effective.has(key)) effective.set(key, "");
  }

  const fill = (text: string, where: string, scope: ReadonlyMap<string, string> = effective) => {
    const result = substitute(text, scope);
    for (const slot of result.missing) {
      if (effective.has(slot)) {
        findings.push({
          gate: "render",
          what: `${where} uses __MKTRUE_${slot}__, which it does not declare from the release pin`,
          why: "a workflow runs with the repository's secrets, so it takes only release values",
          fix: `remove __MKTRUE_${slot}__ from bench/${where}`,
          exit: EXIT.FINDINGS,
        });
        continue;
      }
      findings.push({
        gate: "render",
        what: `${where} uses __MKTRUE_${slot}__ and no value was supplied`,
        why: "the slot is left in place rather than blanked, so the rendered file would ship with it visible",
        fix: manifest.slots[slot]?.from.startsWith("release.")
          ? `add bench/release.json, the release pin ${slot} is read from`
          : `supply ${slot} in the answers, or remove it from bench/${where}`,
        exit: EXIT.FINDINGS,
      });
    }
    return result.text;
  };

  for (const role of manifest.roles) {
    const body = bodies.get(role.body);
    if (body === undefined) continue;
    const path = fill(target.roles.replace("__MKTRUE_ROLE_ID__", role.id), role.body);
    files.push({ path, content: roleFrontmatter(role, target) + "\n" + fill(body, role.body) });
  }

  for (const command of manifest.commands) {
    const body = bodies.get(command.body);
    if (body === undefined) continue;
    const path = fill(target.commands.replace("__MKTRUE_COMMAND_ID__", command.id), command.body);
    files.push({ path, content: fill(body, command.body) });
  }

  for (const contract of manifest.contracts) {
    const body = bodies.get(contract.body);
    if (body === undefined) continue;
    files.push({ path: contract.renderTo, content: fill(body, contract.body) });
  }

  for (const workflow of manifest.workflows) {
    const body = bodies.get(workflow.body);
    if (body === undefined) continue;
    const released = new Map(
      [...effective].filter(
        ([key]) =>
          workflow.slots.includes(key) && manifest.slots[key]?.from.startsWith("release.") === true,
      ),
    );
    files.push({ path: workflow.renderTo, content: fill(body, workflow.body, released) });
  }

  const sections = [...manifest.rules].sort((a, b) => a.section - b.section);
  const managed: RenderedRegion[] = [];
  const skeletonParts: string[] = [];

  for (const section of sections) {
    const body = bodies.get(section.body);
    if (body === undefined) continue;
    const content = fill(body, section.body).trimEnd();
    if (section.owner === "kit") {
      const id = `rules:${section.section}`;
      managed.push({ id, content });
      skeletonParts.push(writeRegion(undefined, id, content).trimEnd());
    } else {
      skeletonParts.push(content);
    }
  }

  const rules: RenderedRules = {
    path: target.rules,
    managed,
    skeleton: skeletonParts.length > 0 ? `${skeletonParts.join("\n\n")}\n` : "",
  };

  return { files, rules, findings };
}
