import { CONTROL_OR_INVISIBLE_CLASS } from "@mktrue/contracts";
import { EXIT, type ExitCode } from "@mktrue/core";

import type { Output } from "./ports.js";

export const COLUMNS = 80;

const CONTROL_OR_INVISIBLE = new RegExp(`[${CONTROL_OR_INVISIBLE_CLASS}]`, "gu");

export function printable(text: string): string {
  return text.replace(CONTROL_OR_INVISIBLE, "");
}

const COMBINING_MARK = /\p{M}/u;

/**
 * East Asian Wide and Fullwidth ranges (Unicode's `EastAsianWidth.txt`), the
 * characters a terminal draws two columns wide.
 */
function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0x303e) ||
    (codePoint >= 0x3041 && codePoint <= 0x33ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xa000 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

/** A combining mark draws zero columns; an East Asian wide glyph draws two. */
function glyphWidth(glyph: string): number {
  if (COMBINING_MARK.test(glyph)) return 0;
  return isWideCodePoint(glyph.codePointAt(0)!) ? 2 : 1;
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const glyph of text) width += glyphWidth(glyph);
  return width;
}

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  if (displayWidth(flat) <= max) return flat;
  const budget = Math.max(0, max - 1);
  let width = 0;
  let kept = "";
  for (const glyph of flat) {
    const next = width + glyphWidth(glyph);
    if (next > budget) break;
    kept += glyph;
    width = next;
  }
  return `${kept}…`;
}

const PATH_WIDTH = 40;

const ACTION_WIDTH = 10;

export function row(action: string, path: string, reason: string): string {
  const shown = path.length > PATH_WIDTH ? `…${path.slice(path.length - PATH_WIDTH + 1)}` : path;
  const head = `  ${action.padEnd(ACTION_WIDTH)}${shown.padEnd(PATH_WIDTH)} `;
  return `${head}${clip(reason, COLUMNS - head.length)}`;
}

export function refuse(
  out: Output,
  gate: string,
  what: string,
  why: string,
  fix: string,
  exit: ExitCode,
): ExitCode {
  out.line(`mktrue: ✗ ${gate} · ${what}`);
  out.line(`  why   ${why}`);
  out.line(`  fix   ${fix}`);
  out.line(`  exit  ${exit}`);
  return exit;
}

export function errorCode(error: unknown): string {
  const { code, name } = (error ?? {}) as { code?: unknown; name?: unknown };
  if (typeof code === "string" && /^[A-Z0-9_]{1,38}$/.test(code)) return code;
  if (typeof name === "string" && /^[A-Z][A-Za-z]{0,37}$/.test(name)) return name;
  return "an unknown error";
}

export function internalError(out: Output, error: unknown): ExitCode {
  return refuse(
    out,
    "internal",
    `an unexpected error: ${errorCode(error)}`,
    "this is a defect in mktrue, not something wrong with your repository",
    "report it with the command you ran; nothing was written",
    EXIT.FINDINGS,
  );
}
