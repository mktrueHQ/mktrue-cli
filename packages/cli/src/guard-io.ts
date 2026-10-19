import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { RESUME_FILE } from "@mktrue/core";

import { readOnlyGit } from "./git.js";
import type { GuardPorts } from "./ports.js";

export const TAIL_CHUNK_BYTES = 64 * 1024;
const STDIN_MAX_BYTES = 16 * 1024 * 1024;
const CONFIG_MAX_BYTES = 1024 * 1024;
const RESUME_MAX_BYTES = 64 * 1024;
const MAX_LEVELS = 64;

function isFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function present(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

const READ_REGULAR = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/** An open regular file and its size; a link, a FIFO or a device is never opened for reading. */
function openRegular(path: string): { fd: number; size: number } | undefined {
  let fd: number;
  try {
    fd = openSync(path, READ_REGULAR);
  } catch {
    return undefined;
  }
  try {
    const stats = fstatSync(fd);
    if (stats.isFile()) return { fd, size: stats.size };
  } catch {
    // closed below
  }
  closeSync(fd);
  return undefined;
}

function readSmall(path: string, maxBytes: number): string | undefined {
  const file = openRegular(path);
  if (file === undefined) return undefined;
  try {
    if (file.size > maxBytes) return undefined;
    const bytes = Buffer.alloc(file.size);
    const read = readSync(file.fd, bytes, 0, bytes.length, 0);
    return bytes.subarray(0, read).toString("utf8");
  } finally {
    closeSync(file.fd);
  }
}

/** A file's chunks, last first, each read only when the one after it was consumed. */
export function* chunksBackward(
  path: string,
  chunkBytes: number = TAIL_CHUNK_BYTES,
  onRead: (bytes: number) => void = () => {},
): Generator<Uint8Array> {
  const file = openRegular(path);
  if (file === undefined) return;
  try {
    let end = file.size;
    while (end > 0) {
      const start = Math.max(0, end - chunkBytes);
      const chunk = Buffer.alloc(end - start);
      const read = readSync(file.fd, chunk, 0, chunk.length, start);
      onRead(read);
      yield chunk.subarray(0, read);
      end = start;
    }
  } finally {
    closeSync(file.fd);
  }
}

async function readStdin(): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > STDIN_MAX_BYTES) return undefined;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function nodeGuardPorts(): GuardPorts {
  return {
    stdin: readStdin,
    write: (text) =>
      new Promise((done) => {
        process.stdout.write(text, () => done());
      }),
    config(cwd) {
      let dir = cwd;
      for (let level = 0; level < MAX_LEVELS; level += 1) {
        const config = join(dir, ".mktrue.json");
        if (isFile(config)) {
          const text = readSmall(config, CONFIG_MAX_BYTES);
          return text === undefined ? undefined : { root: dir, text };
        }
        if (present(join(dir, ".git"))) return undefined;
        const parent = dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
      }
      return undefined;
    },
    tail: (path) => chunksBackward(path),
    exists: isFile,
    async mainCheckout(root) {
      const common = await readOnlyGit(root).git("rev-parse", [
        "--path-format=absolute",
        "--git-common-dir",
      ]);
      const dir = common?.replace(/\n$/, "");
      if (dir === undefined || !dir.endsWith("/.git")) return undefined;
      return dir.slice(0, -"/.git".length);
    },
    newestResume(main) {
      const slices = join(main, ".mktrue", "slices");
      let newest: { path: string; mtime: number } | undefined;
      let entries: string[];
      try {
        entries = readdirSync(slices);
      } catch {
        return undefined;
      }
      for (const entry of entries) {
        const folder = join(slices, entry);
        const path = join(folder, RESUME_FILE);
        try {
          if (!lstatSync(folder).isDirectory()) continue;
          const stats = lstatSync(path);
          if (!stats.isFile()) continue;
          if (newest === undefined || stats.mtimeMs > newest.mtime) {
            newest = { path, mtime: stats.mtimeMs };
          }
        } catch {
          continue;
        }
      }
      if (newest === undefined) return undefined;
      const content = readSmall(newest.path, RESUME_MAX_BYTES);
      return content === undefined ? undefined : { path: newest.path, content };
    },
  };
}
