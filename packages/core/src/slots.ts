import type { BenchManifest } from "@mktrue/contracts";

// Lazy on purpose: a greedy key misreads `__MKTRUE_NAME_UPPER___DB_PASSWORD`.
export const SLOT_PATTERN = /__MKTRUE_([A-Z0-9_]+?)__/g;

export function slotsIn(text: string): Set<string> {
  return new Set([...text.matchAll(SLOT_PATTERN)].map((match) => match[1] as string));
}

export function formatSlotValue(
  value: unknown,
  kind: string,
  separator?: string,
  empty?: string,
): string {
  if (kind === "path" && typeof value === "string") {
    return value === "" ? "not in this repository" : `\`${value}\``;
  }
  if (Array.isArray(value)) {
    if (value.length === 0 && empty !== undefined) return empty;
    return value.map(String).join(separator ?? ", ");
  }
  if (kind === "number" && typeof value === "number") {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }
  return String(value);
}

export interface Substitution {
  readonly text: string;
  readonly missing: readonly string[];
}

export function substitute(text: string, values: ReadonlyMap<string, string>): Substitution {
  const missing: string[] = [];
  const out = text.replace(SLOT_PATTERN, (whole, key: string) => {
    const value = values.get(key);
    if (value === undefined) {
      if (!missing.includes(key)) missing.push(key);
      return whole;
    }
    return value;
  });
  return { text: out, missing };
}

/** Where a free-text answer lands, so it can be escaped for that language. */
export type EscapeContext = "js" | "json" | "icu" | "css" | "env" | "none";

export function escapeContextForPath(path: string): EscapeContext {
  if (/\.(ts|tsx|js|mjs|cjs)$/.test(path)) return "js";
  if (/(^|\/)messages\/[^/]+\.json$/.test(path)) return "icu";
  if (/\.json$/.test(path)) return "json";
  if (/\.css$/.test(path)) return "css";
  if (/\.env[^/]*$/.test(path)) return "env";
  return "none";
}

export function escapeForContext(value: string, context: EscapeContext): string {
  switch (context) {
    case "js":
      // Hex escapes mean the same in a ", ' or ` literal, so no lint rule calls one useless and
      // Prettier never picks another quote for the string.
      return value
        .replace(/\\/g, "\\\\")
        .replace(/`/g, "\\x60")
        .replace(/"/g, "\\x22")
        .replace(/'/g, "\\x27")
        .replace(/\$\{/g, "\\x24{")
        .replace(/\*\//g, "*\\x2f");
    case "json":
      return JSON.stringify(value).slice(1, -1);
    case "icu":
      // A message catalogue is ICU as well as JSON: `'` doubles to print itself, and `{`/`}`
      // are quoted so next-intl reads them as text, not as an argument.
      return JSON.stringify(value.replace(/'/g, "''").replace(/[{}]/g, "'$&'")).slice(1, -1);
    case "css":
      // Only `*/` can do anything inside a CSS comment; a backslash or a quote is inert there.
      return value.replace(/\*\//g, "*\\/");
    case "env":
      // util.parseEnv has no escape for a quoted value: raw is exact except for a literal `"`.
      return value;
    default:
      return value;
  }
}

/**
 * Slots whose value is a founder's free text: `kind` is `text` or `list`, and it is neither
 * `name` (already refused anything unsafe by its own regex) nor derived (already a literal).
 */
export function freeTextSlotKeys(
  slots: Readonly<Record<string, { readonly kind: string; readonly from: string }>>,
): Set<string> {
  const keys = new Set<string>();
  for (const [key, slot] of Object.entries(slots)) {
    if (slot.kind !== "text" && slot.kind !== "list") continue;
    if (slot.from === "answers.name") continue;
    if (slot.from.startsWith("derived.")) continue;
    // A port is `portSchema`-validated (an integer, 1024-65535): its kind reads "text" only so
    // formatSlotValue never adds a thousands separator to it, not because it carries prose.
    if (slot.from.startsWith("answers.ports.")) continue;
    keys.add(key);
  }
  return keys;
}

/** `substitute`, escaping every free-text slot for the language `path`'s extension implies. */
export function substituteForFile(
  path: string,
  text: string,
  values: ReadonlyMap<string, string>,
  freeText: ReadonlySet<string>,
): Substitution {
  const context = escapeContextForPath(path);
  if (context === "none") return substitute(text, values);
  const escaped = new Map(
    [...values].map(([key, value]) => [
      key,
      freeText.has(key) ? escapeForContext(value, context) : value,
    ]),
  );
  return substitute(text, escaped);
}

export function slotValues(
  manifest: { readonly slots: BenchManifest["slots"] },
  sources: Readonly<Record<string, unknown>>,
): Map<string, string> {
  const values = new Map<string, string>();
  for (const [key, slot] of Object.entries(manifest.slots)) {
    const resolved = slot.from.split(".").reduce<unknown>((node, part) => {
      if (node === null || typeof node !== "object") return undefined;
      if (!Object.hasOwn(node, part)) return undefined;
      return (node as Record<string, unknown>)[part];
    }, sources);
    if (resolved === undefined) continue;
    values.set(key, formatSlotValue(resolved, slot.kind, slot.separator, slot.empty));
  }
  return values;
}
