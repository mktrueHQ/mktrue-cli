import { LOCALES, localeSchema, type Locale } from "@__MKTRUE_NAME__/contracts";

export const DEFAULT_LOCALE: Locale = LOCALES[0];

export function asLocale(value: unknown): Locale | undefined {
  const parsed = localeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
