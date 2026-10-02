#!/usr/bin/env node
import { cpSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// decision 0034: the package ships the skill; the source stays at the root.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COPY = join(ROOT, "packages", "cli", "skill");

rmSync(COPY, { recursive: true, force: true });
cpSync(join(ROOT, "skill"), COPY, { recursive: true });
