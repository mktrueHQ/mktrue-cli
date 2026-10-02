import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { LOCALES } from "@__MKTRUE_NAME__/contracts";
import { describe, expect, it } from "vitest";

import { catalogueFor } from "@/i18n/catalogues";

const MESSAGES = join(import.meta.dirname, "..", "messages");

function keysOf(node: unknown, prefix = ""): string[] {
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    typeof value === "string" ? [`${prefix}${key}`] : keysOf(value, `${prefix}${key}.`),
  );
}

const read = (locale: string): unknown =>
  JSON.parse(readFileSync(join(MESSAGES, `${locale}.json`), "utf8"));

describe("the catalogues", () => {
  it("are exactly one per locale the contract declares", () => {
    expect(
      readdirSync(MESSAGES)
        .map((file) => file.replace(/\.json$/, ""))
        .toSorted(),
    ).toEqual([...LOCALES].toSorted());
  });

  it.each(LOCALES)("loads the %s catalogue", async (locale) => {
    expect(await catalogueFor(locale)).toEqual(read(locale));
  });

  it.each(LOCALES)("gives %s exactly the default's keys", (locale) => {
    expect(keysOf(read(locale)).toSorted()).toEqual(keysOf(read(LOCALES[0])).toSorted());
  });

  it.each(LOCALES)("has no empty string in %s", (locale) => {
    const empty = keysOf(read(locale)).filter((key) => {
      const value = key
        .split(".")
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], read(locale));
      return typeof value === "string" && value.trim() === "";
    });
    expect(empty).toEqual([]);
  });
});
