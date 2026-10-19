import type { AuditUsage } from "@mktrue/contracts";

const NEWLINE = 0x0a;
const SYNTHETIC_MODEL = "<synthetic>";

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

const decoder = new TextDecoder("utf-8", { fatal: false });

export const LINE_MAX_BYTES = 1024 * 1024;
export const SCAN_MAX_BYTES = 8 * 1024 * 1024;

function joinPieces(piecesLastFirst: readonly Uint8Array[], length: number): Uint8Array {
  const joined = new Uint8Array(length);
  let at = 0;
  for (let i = piecesLastFirst.length - 1; i >= 0; i -= 1) {
    const piece = piecesLastFirst[i] as Uint8Array;
    joined.set(piece, at);
    at += piece.length;
  }
  return joined;
}

/**
 * The lines of a file, last first, from its chunks read last first. A line split across chunks
 * is joined before it is decoded, so a record or a character never breaks at a boundary. A line
 * longer than `line` bytes is dropped, and no chunk is pulled once `scan` bytes were read.
 */
export function* linesBackward(
  chunks: Iterable<Uint8Array>,
  limits: { readonly line: number; readonly scan: number } = {
    line: LINE_MAX_BYTES,
    scan: SCAN_MAX_BYTES,
  },
): Generator<string> {
  let pieces: Uint8Array[] = [];
  let carried = 0;
  let overlong = false;
  let scanned = 0;
  const carry = (piece: Uint8Array) => {
    if (overlong || piece.length === 0) return;
    carried += piece.length;
    if (carried > limits.line) {
      overlong = true;
      pieces = [];
      return;
    }
    pieces.push(piece);
  };
  for (const chunk of chunks) {
    scanned += chunk.length;
    let end = chunk.length;
    for (let at = chunk.length - 1; at >= 0; at -= 1) {
      if (chunk[at] !== NEWLINE) continue;
      carry(chunk.subarray(at + 1, end));
      if (!overlong) yield decoder.decode(joinPieces(pieces, carried));
      pieces = [];
      carried = 0;
      overlong = false;
      end = at;
    }
    carry(chunk.subarray(0, end));
    if (scanned >= limits.scan) return;
  }
  if (!overlong && carried > 0) yield decoder.decode(joinPieces(pieces, carried));
}

function usageOfRecord(line: string): AuditUsage | undefined {
  if (!line.includes('"usage"')) return undefined;
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isObject(record) || record.type !== "assistant" || !isObject(record.message)) {
    return undefined;
  }
  const { message } = record;
  if (message.model === SYNTHETIC_MODEL || !isObject(message.usage)) return undefined;
  const input = count(message.usage.input_tokens);
  if (input === undefined) return undefined;
  return {
    input,
    output: count(message.usage.output_tokens) ?? 0,
    cacheRead: count(message.usage.cache_read_input_tokens) ?? 0,
    cacheCreation: count(message.usage.cache_creation_input_tokens) ?? 0,
  };
}

/** The usage of the last assistant record, reading lines last first and stopping at it. */
export function lastUsage(linesFromEnd: Iterable<string>): AuditUsage | undefined {
  for (const line of linesFromEnd) {
    const usage = usageOfRecord(line);
    if (usage !== undefined) return usage;
  }
  return undefined;
}

/** The distinct tool calls an agent's transcript records, counted by their ids. */
export function countToolCalls(lines: Iterable<string>): number {
  const ids = new Set<string>();
  for (const line of lines) {
    if (!line.includes('"tool_use"')) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(record) || record.type !== "assistant" || !isObject(record.message)) continue;
    const content = record.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (isObject(block) && block.type === "tool_use" && typeof block.id === "string") {
        ids.add(block.id);
      }
    }
  }
  return ids.size;
}
