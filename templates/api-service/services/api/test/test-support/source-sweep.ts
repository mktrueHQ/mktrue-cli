import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

export const SOURCE_ROOT = new URL("../../src/", import.meta.url).pathname;

export const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

export async function everySourceFile(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return everySourceFile(path);
      return /\.[cm]?ts$/.test(entry.name) ? [path] : [];
    }),
  );
  return found.flat();
}

export interface SweptFile {
  readonly path: string;
  readonly code: string;
}

export async function sweep(directoryInSource: string): Promise<SweptFile[]> {
  const paths = await everySourceFile(join(SOURCE_ROOT, directoryInSource));
  return Promise.all(
    paths.map(async (path) => ({
      path: relative(SOURCE_ROOT, path),
      code: withoutComments(await readFile(path, "utf8")),
    })),
  );
}

export const readSource = (pathInSource: string): Promise<string> =>
  readFile(join(SOURCE_ROOT, pathInSource), "utf8");
