import { LOCALES } from "@__MKTRUE_NAME__/contracts";
import { describe, expect, it } from "vitest";

import { parseAcceptLanguage } from "@/i18n/accept-language";

describe("parseAcceptLanguage", () => {
  it("picks a locale this product speaks", () => {
    expect(parseAcceptLanguage("en-GB,en;q=0.9")).toBe("en");
  });

  it("answers nothing for no header, or only languages it does not speak", () => {
    expect(parseAcceptLanguage(null)).toBeUndefined();
    expect(parseAcceptLanguage("xx-YY,zz;q=0.8")).toBeUndefined();
  });

  it("never picks a language the browser marked unacceptable", () => {
    expect(parseAcceptLanguage("en;q=0")).toBeUndefined();
  });

  it("prefers the higher quality among the ones it speaks", () => {
    const last = LOCALES[LOCALES.length - 1] ?? LOCALES[0];

    expect(parseAcceptLanguage(`${LOCALES[0]};q=0.1,${last};q=0.9`)).toBe(last);
  });
});
