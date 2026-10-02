import { EXIT, type Finding } from "./findings.js";

const START = (id: string): string => `<!-- mktrue:${id}:start -->`;
const END = (id: string): string => `<!-- mktrue:${id}:end -->`;

export function extractRegion(content: string, id: string): string | undefined {
  const from = content.indexOf(START(id));
  if (from === -1) return undefined;
  const to = content.indexOf(END(id), from);
  if (to === -1) return undefined;
  return content.slice(from + START(id).length, to).trim();
}

export function regionIds(content: string): string[] {
  return [...content.matchAll(/<!-- mktrue:([a-z0-9:-]+):start -->/g)].map((m) => m[1] as string);
}

export function writeRegion(content: string | undefined, id: string, next: string): string {
  // Blank lines inside the markers, or a formatter adds them and reports drift.
  const block = `${START(id)}\n\n${next.trim()}\n\n${END(id)}`;

  if (content === undefined || content.trim() === "") return `${block}\n`;

  const from = content.indexOf(START(id));
  if (from !== -1) {
    const to = content.indexOf(END(id), from);
    if (to !== -1) {
      return content.slice(0, from) + block + content.slice(to + END(id).length);
    }
    return content;
  }

  const lines = content.split("\n");
  const titleAt = lines.findIndex((line) => line.startsWith("# "));
  if (titleAt === -1) return `${block}\n\n${content}`;

  lines.splice(titleAt + 1, 0, "", block);
  return lines.join("\n");
}

export function unterminatedRegion(content: string, id: string): Finding | undefined {
  const from = content.indexOf(START(id));
  if (from === -1) return undefined;
  if (content.indexOf(END(id), from) !== -1) return undefined;
  return {
    gate: "sync",
    what: `a mktrue:${id} region is opened and never closed`,
    why: "sync cannot tell where the kit's text ends and yours begins, so it will not rewrite the file at all",
    fix: `add ${END(id)} where the kit's section ends, or delete the opening marker to give the section back to this repository`,
    exit: EXIT.DECISION,
  };
}
