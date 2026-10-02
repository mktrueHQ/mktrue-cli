import type { Locale } from "@__MKTRUE_NAME__/contracts";
import type { Messages } from "next-intl";

export async function catalogueFor(locale: Locale): Promise<Messages> {
  return ((await import(`../messages/${locale}.json`)) as { default: Messages }).default;
}
