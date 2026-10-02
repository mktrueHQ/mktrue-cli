import { createHash } from "node:crypto";

export function hashContent(content: string): string {
  const lf = content.replaceAll("\r\n", "\n");
  return `sha256-${createHash("sha256").update(lf, "utf8").digest("hex")}`;
}

export function stampHeader(kitVersion: string, comment: string): string {
  return `${comment} mktrue ${kitVersion} · a kit-owned file · \`mktrue sync\` updates it`;
}
