import type { Locale } from "@__MKTRUE_NAME__/contracts";

import { asLocale } from "./locales";

const MAX_RANGES = 64;
const QVALUE = /^\d*(?:\.\d*)?$/;

export function parseAcceptLanguage(header: string | null): Locale | undefined {
  if (header === null) return undefined;

  let best: { readonly locale: Locale; readonly quality: number } | undefined;
  for (const range of header.split(",", MAX_RANGES)) {
    const [tag = "", ...parameters] = range.split(";");
    const locale = asLocale(tag.trim().toLowerCase().split("-")[0]);
    if (locale === undefined) continue;

    const quality = qualityOf(parameters);
    if (quality > 0 && (best === undefined || quality > best.quality)) best = { locale, quality };
  }
  return best?.locale;
}

function qualityOf(parameters: readonly string[]): number {
  for (const parameter of parameters) {
    const compact = parameter.replace(/\s+/g, "").toLowerCase();
    if (!compact.startsWith("q=")) continue;
    const value = compact.slice("q=".length);
    return QVALUE.test(value) ? Math.min(Math.max(Number(value), 0), 1) : 0;
  }
  return 1;
}
