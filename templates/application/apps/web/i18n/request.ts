import type { Locale } from "@__MKTRUE_NAME__/contracts";
import { getRequestConfig } from "next-intl/server";
import { headers } from "next/headers";

import { readProfileLocale } from "@/lib/profile";

import { parseAcceptLanguage } from "./accept-language";
import { catalogueFor } from "./catalogues";
import { DEFAULT_LOCALE } from "./locales";

export default getRequestConfig(async () => {
  const locale = (await readProfileLocale()) ?? (await browserLocale()) ?? DEFAULT_LOCALE;
  return { locale, messages: await catalogueFor(locale) };
});

async function browserLocale(): Promise<Locale | undefined> {
  try {
    return parseAcceptLanguage((await headers()).get("accept-language"));
  } catch {
    return undefined;
  }
}
