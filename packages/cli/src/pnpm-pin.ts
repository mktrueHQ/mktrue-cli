import { pnpmPin } from "@mktrue/core";

import { EMBEDDED_TEMPLATES } from "./templates.embedded.js";

/** The pnpm pin the offered templates share, read from the embedded `api-service`. */
export function templatesPnpmPin(): string {
  const pin = pnpmPin(EMBEDDED_TEMPLATES["api-service/package.json"] ?? "");
  if (pin === undefined) {
    throw new Error("templates.embedded.js: api-service/package.json holds no pnpm pin");
  }
  return pin;
}
