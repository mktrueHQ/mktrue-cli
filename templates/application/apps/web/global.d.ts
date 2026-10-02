import type { Locale } from "@__MKTRUE_NAME__/contracts";

import type en from "./messages/en.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof en;
  }
}
