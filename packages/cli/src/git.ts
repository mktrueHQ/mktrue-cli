import path, { dirname, type PlatformPath } from "node:path";

import type { SiblingGit } from "./ports.js";
import { spawnCommand } from "./spawn.js";

export const GIT_VERBS: readonly string[] = ["rev-parse", "cat-file"];

export const MAX_BLOB_BYTES = 1024 * 1024;

export type GitSpawn = (
  argv: readonly string[],
  cwd: string,
) => Promise<{ code: number | null; stdout: string }>;

export class GitRefused extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "GitRefused";
  }
}

export class BlobTooLarge extends Error {
  constructor(readonly path: string) {
    super(`${path} is over ${MAX_BLOB_BYTES} bytes`);
    this.name = "BlobTooLarge";
  }
}

const SAFE_REF = /^refs\/(heads|remotes\/origin)\/[A-Za-z0-9_][A-Za-z0-9._/-]*$/;
const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

export function isSafeRef(ref: string): boolean {
  return (
    SAFE_REF.test(ref) &&
    !ref.includes("..") &&
    !ref.includes("//") &&
    !ref.endsWith("/") &&
    !ref.endsWith(".") &&
    !ref.endsWith(".lock")
  );
}

export function isSafePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.startsWith("-") &&
    !path.startsWith("\\") &&
    !/^[A-Za-z]:/.test(path) &&
    !path.split(/[\\/]/).some((part) => part === ".." || part === "") &&
    !/[\u0000-\u001f\u007f]/.test(path)
  );
}

function gitEnvironment(dir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("GIT_")) env[key] = value;
  }
  return {
    ...env,
    GIT_CEILING_DIRECTORIES: dirname(dir),
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

export const spawnGit: GitSpawn = (argv, cwd) =>
  new Promise((done, fail) => {
    if (argv.length === 0) {
      fail(new Error("nothing to run"));
      return;
    }
    const child = spawnCommand(argv, {
      cwd,
      env: gitEnvironment(cwd),
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (child === undefined) {
      done({ code: null, stdout: "" });
      return;
    }
    const chunks: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") done({ code: null, stdout: "" });
      else fail(error);
    });
    child.on("close", (code) => {
      try {
        done({ code, stdout: Buffer.concat(chunks).toString("utf8") });
      } catch (error) {
        fail(error);
      }
    });
  });

export function readOnlyGit(
  dir: string,
  run: GitSpawn = spawnGit,
  paths: Pick<PlatformPath, "normalize"> = path,
): SiblingGit & {
  git(verb: string, args: readonly string[]): Promise<string | undefined>;
  topLevel(): Promise<string | undefined>;
} {
  const git = async (verb: string, args: readonly string[]): Promise<string | undefined> => {
    if (!GIT_VERBS.includes(verb)) throw new GitRefused(`git ${verb} is not a read`);
    const { code, stdout } = await run(["git", verb, ...args], dir);
    return code === 0 ? stdout : undefined;
  };

  return {
    git,

    async topLevel() {
      const shown = await git("rev-parse", ["--show-toplevel"]);
      return shown === undefined ? undefined : paths.normalize(shown.replace(/\n$/, ""));
    },

    async resolve(ref) {
      if (!isSafeRef(ref)) throw new GitRefused(`${ref} is not a branch ref mktrue reads`);
      const commit = (await git("rev-parse", ["--verify", "--quiet", `${ref}^{commit}`]))?.trim();
      if (commit === undefined || !COMMIT.test(commit)) return undefined;
      const short = (await git("rev-parse", ["--short", commit]))?.trim();
      return { commit, short: short !== undefined && short !== "" ? short : commit.slice(0, 7) };
    },

    async read(commit, path) {
      if (!COMMIT.test(commit)) throw new GitRefused(`${commit} is not a commit`);
      if (!isSafePath(path)) throw new GitRefused(`${path} is not a path mktrue reads`);
      const size = Number((await git("cat-file", ["-s", `${commit}:${path}`]))?.trim());
      if (!Number.isInteger(size)) return undefined;
      if (size > MAX_BLOB_BYTES) throw new BlobTooLarge(path);
      return git("cat-file", ["blob", `${commit}:${path}`]);
    },
  };
}
